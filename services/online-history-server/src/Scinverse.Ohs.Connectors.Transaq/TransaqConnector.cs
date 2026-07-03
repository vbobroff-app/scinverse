using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using System.Threading.Channels;
using System.Xml.Linq;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>
/// Реальный коннектор к TRANSAQ через нативный txmlconnector.dll (P/Invoke).
/// ВНИМАНИЕ: битность процесса обязана совпадать с DLL; соглашение вызова (stdcall)
/// и точные сигнатуры следует сверять с версией используемого коннектора.
/// Не покрывается юнит-тестами (требует нативную DLL и учётные данные).
/// </summary>
public sealed class TransaqConnector : IMarketConnector
{
    private const string NativeDll = "txmlconnector.dll";
    private const CallingConvention Convention = CallingConvention.StdCall;

    private static string? _configuredDllPath;
    private static int _resolverInstalled;

    private readonly TransaqConnectorOptions _options;
    private readonly Channel<string> _messages;

    // Держим ссылку на делегат, чтобы GC не собрал его, пока DLL хранит указатель.
    private readonly CallbackDelegate _callback;

    private bool _initialized;

    public TransaqConnector(TransaqConnectorOptions options)
    {
        _options = options;
        _callback = OnRawData;
        _messages = Channel.CreateUnbounded<string>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = true
        });
    }

    public ChannelReader<string> Messages => _messages.Reader;

    public bool IsConnected { get; private set; }

    public Task ConnectAsync(CancellationToken cancellationToken)
    {
        EnsureResolver(_options.DllPath);
        Directory.CreateDirectory(_options.LogDir);

        EnsureSuccess(Initialize(_options.LogDir, _options.LogLevel), "Initialize");
        _initialized = true;

        if (!SetCallback(_callback))
        {
            throw new InvalidOperationException("TRANSAQ SetCallback вернул false");
        }

        var command = new StringBuilder()
            .Append("<command id=\"connect\">")
            .Append("<login>").Append(SecurityElement.Escape(_options.Login)).Append("</login>")
            .Append("<password>").Append(SecurityElement.Escape(_options.Password)).Append("</password>")
            .Append("<host>").Append(SecurityElement.Escape(_options.Host)).Append("</host>")
            .Append("<port>").Append(_options.Port).Append("</port>")
            .Append("<rqdelay>100</rqdelay>")
            .Append("<session_timeout>60</session_timeout>")
            .Append("<request_timeout>20</request_timeout>")
            .Append("</command>")
            .ToString();

        EnsureSuccess(SendCommand(command), "connect");
        IsConnected = true;
        return Task.CompletedTask;
    }

    public Task SubscribeTradesAsync(IReadOnlyCollection<InstrumentKey> instruments, CancellationToken cancellationToken)
    {
        var command = new StringBuilder("<command id=\"subscribe\"><alltrades>");
        foreach (var instrument in instruments)
        {
            command
                .Append("<security board=\"").Append(SecurityElement.Escape(instrument.Board)).Append('"')
                .Append(" seccode=\"").Append(SecurityElement.Escape(instrument.Seccode)).Append("\"/>");
        }

        command.Append("</alltrades></command>");
        EnsureSuccess(SendCommand(command.ToString()), "subscribe");
        return Task.CompletedTask;
    }

    public Task DisconnectAsync(CancellationToken cancellationToken)
    {
        if (IsConnected)
        {
            EnsureSuccess(SendCommand("<command id=\"disconnect\"/>"), "disconnect");
            IsConnected = false;
        }

        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            await DisconnectAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (InvalidOperationException)
        {
            // Отключение по best-effort: игнорируем ошибки коннектора при выгрузке.
        }

        if (_initialized)
        {
            _ = UnInitialize();
            _initialized = false;
        }

        _messages.Writer.TryComplete();
    }

    private bool OnRawData(IntPtr data)
    {
        var xml = Marshal.PtrToStringUTF8(data);
        if (xml is not null)
        {
            _messages.Writer.TryWrite(xml);
        }

        return true;
    }

    private static void EnsureSuccess(IntPtr resultPtr, string operation)
    {
        if (resultPtr == IntPtr.Zero)
        {
            return;
        }

        string? result;
        try
        {
            result = Marshal.PtrToStringUTF8(resultPtr);
        }
        finally
        {
            _ = FreeMemory(resultPtr);
        }

        if (string.IsNullOrWhiteSpace(result))
        {
            return;
        }

        XDocument document;
        try
        {
            document = XDocument.Parse(result);
        }
        catch (System.Xml.XmlException)
        {
            return;
        }

        var success = document.Root?.Attribute("success")?.Value;
        if (string.Equals(success, "false", StringComparison.OrdinalIgnoreCase))
        {
            var message = (string?)document.Root?.Element("message") ?? result;
            throw new InvalidOperationException($"TRANSAQ '{operation}' failed: {message}");
        }
    }

    private static void EnsureResolver(string dllPath)
    {
        _configuredDllPath = dllPath;
        if (Interlocked.Exchange(ref _resolverInstalled, 1) != 0)
        {
            return;
        }

        NativeLibrary.SetDllImportResolver(typeof(TransaqConnector).Assembly, (name, _, _) =>
        {
            if (name == NativeDll
                && !string.IsNullOrWhiteSpace(_configuredDllPath)
                && File.Exists(_configuredDllPath))
            {
                return NativeLibrary.Load(_configuredDllPath);
            }

            return IntPtr.Zero;
        });
    }

    [UnmanagedFunctionPointer(Convention)]
    [return: MarshalAs(UnmanagedType.I1)]
    private delegate bool CallbackDelegate(IntPtr data);

#pragma warning disable SYSLIB1054 // делегат-колбэк несовместим с source-generated LibraryImport
#pragma warning disable CA2101 // маршалинг строк задан явно через LPUTF8Str
    [DllImport(NativeDll, CallingConvention = Convention)]
    private static extern IntPtr Initialize([MarshalAs(UnmanagedType.LPUTF8Str)] string logPath, int logLevel);

    [DllImport(NativeDll, CallingConvention = Convention)]
    private static extern IntPtr UnInitialize();

    [DllImport(NativeDll, CallingConvention = Convention)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SetCallback(CallbackDelegate callback);

    [DllImport(NativeDll, CallingConvention = Convention)]
    private static extern IntPtr SendCommand([MarshalAs(UnmanagedType.LPUTF8Str)] string data);

    [DllImport(NativeDll, CallingConvention = Convention)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool FreeMemory(IntPtr data);
#pragma warning restore CA2101
#pragma warning restore SYSLIB1054
}
