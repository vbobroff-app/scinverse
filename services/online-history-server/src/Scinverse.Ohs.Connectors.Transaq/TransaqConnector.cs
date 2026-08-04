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
public sealed class TransaqConnector : IMarketConnector, ISecurityCatalogProbe, IOptionCatalogLoader
{
    private const string NativeDll = "txmlconnector.dll";
    private const CallingConvention Convention = CallingConvention.StdCall;

    private static string? _configuredDllPath;
    private static int _resolverInstalled;
    private static readonly object NativeLock = new();
    private static bool _nativeInitialized;

    private readonly TransaqConnectorOptions _options;
    private readonly Channel<string> _messages;
    private readonly Channel<ConnectorLinkStateChange> _linkState;

    // Держим ссылку на делегат, чтобы GC не собрал его, пока DLL хранит указатель.
    private readonly CallbackDelegate _callback;

    private bool _connectCommandSent;
    private bool _sessionEstablished;
    private ConnectorLinkState? _currentLinkState;

    // Сигнал асинхронного подтверждения соединения (server_status connected="true").
    private volatile TaskCompletionSource<bool>? _connectedSignal;

    // Диагностика get_securities_info: ждём колбэк с конкретным seccode.
    private volatile TaskCompletionSource<string>? _securityProbe;
    private volatile string? _securityProbeSeccode;

    /// <summary>In-flight SendCommand probe — DLL сериализует команды; не стартуем второй, пока висит первый.</summary>
    private Task<bool>? _probeTask;

    private readonly SemaphoreSlim _optionGate = new(1, 1);
    private volatile TaskCompletionSource<decimal>? _futPriceProbe;
    private volatile string? _futPriceSeccode;
    private volatile TaskCompletionSource<string>? _optionXmlProbe;
    private volatile Func<string, bool>? _optionXmlMatch;

    public TransaqConnector(TransaqConnectorOptions options)
    {
        _options = options;
        _callback = OnRawData;
        _messages = Channel.CreateUnbounded<string>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = true
        });
        _linkState = Channel.CreateUnbounded<ConnectorLinkStateChange>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = true
        });
    }

    public ChannelReader<ConnectorLinkStateChange> LinkStateChanges => _linkState.Reader;

    public string SourceCode => "transaq";

    public ChannelReader<string> Messages => _messages.Reader;

    public bool IsConnected { get; private set; }

    public async Task ConnectAsync(CancellationToken cancellationToken)
    {
        EnsureResolver(_options.DllPath);
        Directory.CreateDirectory(_options.LogDir);

        EnsureNativeInitialized(_options.LogDir, _options.LogLevel);

        if (!SetCallback(_callback))
        {
            throw new InvalidOperationException("TRANSAQ SetCallback вернул false");
        }

        // Готовим сигнал ДО отправки команды: server_status может прийти сразу.
        var signal = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _connectedSignal = signal;

        var command = new StringBuilder()
            .Append("<command id=\"connect\">")
            .Append("<login>").Append(SecurityElement.Escape(_options.Login)).Append("</login>")
            .Append("<password>").Append(SecurityElement.Escape(_options.Password)).Append("</password>")
            .Append("<host>").Append(SecurityElement.Escape(_options.Host)).Append("</host>")
            .Append("<port>").Append(_options.Port).Append("</port>")
            .Append("<rqdelay>100</rqdelay>")
            .Append("<session_timeout>60</session_timeout>")
            .Append("<request_timeout>")
            .Append(_options.RequestTimeoutSeconds > 0 ? _options.RequestTimeoutSeconds : 10)
            .Append("</request_timeout>")
            .Append("</command>")
            .ToString();

        EnsureSuccess(SendCommand(command), "connect");
        _connectCommandSent = true;

        // Команда connect асинхронная: подтверждение приходит колбэком
        // server_status connected="true"; ждём его до таймаута.
        var timeout = TimeSpan.FromSeconds(_options.ConnectTimeoutSeconds);
        try
        {
            await signal.Task.WaitAsync(timeout, cancellationToken).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            throw new InvalidOperationException(
                $"TRANSAQ connect: не получено подтверждение соединения за {timeout.TotalSeconds:0} с");
        }

        IsConnected = true;
        _sessionEstablished = true;
        PublishLinkState(ConnectorLinkState.Live, DateTimeOffset.UtcNow);
    }

    public Task SubscribeTradesAsync(IReadOnlyCollection<InstrumentKey> instruments, CancellationToken cancellationToken)
    {
        // TRANSAQ ожидает security с дочерними элементами board/seccode (не атрибутами).
        var command = new StringBuilder("<command id=\"subscribe\"><alltrades>");
        foreach (var instrument in instruments)
        {
            command
                .Append("<security>")
                .Append("<board>").Append(SecurityElement.Escape(instrument.Board)).Append("</board>")
                .Append("<seccode>").Append(SecurityElement.Escape(instrument.Ticker)).Append("</seccode>")
                .Append("</security>");
        }

        command.Append("</alltrades></command>");
        EnsureSuccess(SendCommand(command.ToString()), "subscribe");
        return Task.CompletedTask;
    }

    public Task UnsubscribeTradesAsync(IReadOnlyCollection<InstrumentKey> instruments, CancellationToken cancellationToken)
    {
        var command = new StringBuilder("<command id=\"unsubscribe\"><alltrades>");
        foreach (var instrument in instruments)
        {
            command
                .Append("<security>")
                .Append("<board>").Append(SecurityElement.Escape(instrument.Board)).Append("</board>")
                .Append("<seccode>").Append(SecurityElement.Escape(instrument.Ticker)).Append("</seccode>")
                .Append("</security>");
        }

        command.Append("</alltrades></command>");
        EnsureSuccess(SendCommand(command.ToString()), "unsubscribe");
        return Task.CompletedTask;
    }

    public Task DisconnectAsync(CancellationToken cancellationToken)
    {
        // После server_status connected="false" IsConnected уже false, но сессия на шлюзе
        // может оставаться — без disconnect повторный connect даёт «connection error».
        if (_sessionEstablished || _connectCommandSent)
        {
            try
            {
                EnsureSuccess(SendCommand("<command id=\"disconnect\"/>"), "disconnect");
            }
            catch (InvalidOperationException)
            {
                // best-effort: обрыв мог случиться раньше
            }

            IsConnected = false;
            _sessionEstablished = false;
            _connectCommandSent = false;
            if (_currentLinkState is not null and not ConnectorLinkState.Down)
            {
                PublishLinkState(ConnectorLinkState.Down, DateTimeOffset.UtcNow, "disconnect");
            }
        }

        return Task.CompletedTask;
    }

    /// <summary>Выгрузка нативной DLL — только при остановке хоста (TRANSAQ процесс-глобален).</summary>
    public static void ShutdownNative()
    {
        lock (NativeLock)
        {
            if (!_nativeInitialized)
            {
                return;
            }

            _ = UnInitialize();
            _nativeInitialized = false;
        }
    }

    private static void EnsureNativeInitialized(string logDir, int logLevel)
    {
        lock (NativeLock)
        {
            if (_nativeInitialized)
            {
                return;
            }

            EnsureSuccess(Initialize(logDir, logLevel), "Initialize");
            _nativeInitialized = true;
        }
    }

    public async Task<bool> ProbeConnectionAsync(CancellationToken cancellationToken)
    {
        if (!IsConnected)
        {
            return false;
        }

        var timeoutSec = _options.ProbeTimeoutSeconds > 0 ? _options.ProbeTimeoutSeconds : 3;
        var timeout = TimeSpan.FromSeconds(timeoutSec);

        // Уже висит SendCommand (обрыв кабеля → DLL ждёт TCP ~20–50 с): не шлём второй,
        // ждём тот же task ещё timeout — иначе stall-тик блокируется на минуту.
        var inFlight = _probeTask;
        if (inFlight is { IsCompleted: false })
        {
            try
            {
                return await inFlight.WaitAsync(timeout, cancellationToken).ConfigureAwait(false);
            }
            catch (TimeoutException)
            {
                Console.WriteLine(
                    $"[LinkDetect] Transaq probe: BUSY+TIMEOUT >{timeoutSec}s " +
                    $"(prev SendCommand still in DLL), IsConnected={IsConnected}, link={_currentLinkState}");
                return false;
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return false;
            }
        }

        var sendTask = Task.Run(SendServtimeProbe, CancellationToken.None);
        _probeTask = sendTask;
        try
        {
            return await sendTask.WaitAsync(timeout, cancellationToken).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            Console.WriteLine(
                $"[LinkDetect] Transaq probe: TIMEOUT >{timeoutSec}s " +
                $"(DLL ещё в SendCommand — считаем линк мёртвым), " +
                $"IsConnected={IsConnected}, link={_currentLinkState}");
            return false;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return false;
        }
    }

    /// <summary>
    /// Синхронный SendCommand get_servtime_difference. Ответ — в result XML
    /// (<c>success</c> + <c>diff</c>), не в колбэке. На живом линке ~50–100 мс; на обрыве
    /// кабеля DLL может блокировать поток десятки секунд и вернуть stale success.
    /// </summary>
    private bool SendServtimeProbe()
    {
        try
        {
            var xml = SendCommandRaw("<command id=\"get_servtime_difference\"/>");
            var ok = IsServtimeProbeSuccess(xml);
            Console.WriteLine(
                $"[LinkDetect] Transaq probe: SendCommand {(ok ? "ok" : "FAIL")} " +
                $"diff={ExtractServtimeDiff(xml) ?? "n/a"}, " +
                $"IsConnected={IsConnected}, link={_currentLinkState}");
            return ok;
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"[LinkDetect] Transaq probe: SendCommand FAIL: {ex.Message}");
            return false;
        }
    }

    private static bool IsServtimeProbeSuccess(string? resultXml)
    {
        if (string.IsNullOrWhiteSpace(resultXml))
        {
            return false;
        }

        try
        {
            var root = XDocument.Parse(resultXml).Root;
            var success = root?.Attribute("success")?.Value;
            if (string.Equals(success, "false", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            // diff обязателен: иначе это не ответ servtime (пустой/чужой result).
            return root?.Attribute("diff") is not null;
        }
        catch (System.Xml.XmlException)
        {
            return false;
        }
    }

    private static string? ExtractServtimeDiff(string? resultXml)
    {
        if (string.IsNullOrWhiteSpace(resultXml))
        {
            return null;
        }

        try
        {
            return XDocument.Parse(resultXml).Root?.Attribute("diff")?.Value;
        }
        catch (System.Xml.XmlException)
        {
            return null;
        }
    }

    /// <inheritdoc />
    public async Task<SecurityProbeResult> ProbeSecurityAsync(
        int marketId, string seccode, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (!IsConnected)
        {
            return new SecurityProbeResult(false, false, null, null, "Нет активного соединения с TRANSAQ");
        }

        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        _securityProbeSeccode = seccode;
        _securityProbe = tcs;

        try
        {
            // TRANSAQ требует secid ИЛИ пару market+seccode (board не принимается).
            var command = new StringBuilder()
                .Append("<command id=\"get_securities_info\">")
                .Append("<security>")
                .Append("<market>").Append(marketId).Append("</market>")
                .Append("<seccode>").Append(SecurityElement.Escape(seccode)).Append("</seccode>")
                .Append("</security>")
                .Append("</command>")
                .ToString();

            string? commandXml;
            bool accepted;
            try
            {
                commandXml = SendCommandRaw(command);
                accepted = IsCommandSuccess(commandXml);
                if (!accepted)
                {
                    var failMsg = ExtractCommandMessage(commandXml) ?? "success=false";
                    return new SecurityProbeResult(false, false, commandXml, null,
                        $"get_securities_info отклонён: {failMsg}");
                }
            }
            catch (InvalidOperationException ex)
            {
                return new SecurityProbeResult(false, false, null, null, ex.Message);
            }

            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            linked.CancelAfter(timeout);
            try
            {
                var callback = await tcs.Task.WaitAsync(linked.Token).ConfigureAwait(false);
                return new SecurityProbeResult(true, true, commandXml, callback,
                    $"Шлюз вернул колбэк с {seccode} (market={marketId})");
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return new SecurityProbeResult(true, false, commandXml, null,
                    $"Команда принята, но за {timeout.TotalSeconds:0} с колбэк с {seccode} не пришёл");
            }
        }
        finally
        {
            _securityProbe = null;
            _securityProbeSeccode = null;
        }
    }

    /// <inheritdoc />
    public async Task<decimal?> WaitFuturesTradePriceAsync(
        InstrumentKey futures, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (!IsConnected)
        {
            return null;
        }

        var tcs = new TaskCompletionSource<decimal>(TaskCreationOptions.RunContinuationsAsynchronously);
        _futPriceSeccode = futures.Ticker;
        _futPriceProbe = tcs;
        try
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            linked.CancelAfter(timeout);
            return await tcs.Task.WaitAsync(linked.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return null;
        }
        finally
        {
            _futPriceProbe = null;
            _futPriceSeccode = null;
        }
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<OptionFamily>> GetOptionFamiliesAsync(
        InstrumentKey underlying, TimeSpan timeout, CancellationToken cancellationToken) =>
        WithOptionGateAsync(async () =>
        {
            var xml = await SendOptionCommandAsync(
                BuildSecurityCommand("get_option_families", underlying, matDate: null),
                TransaqOptionXml.IsOptionFamilies,
                timeout,
                cancellationToken).ConfigureAwait(false);
            return (IReadOnlyList<OptionFamily>)(xml is null ? [] : TransaqOptionXml.ParseFamilies(xml));
        }, cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyList<OptionStrikeQuote>> GetFamilyStrikesAsync(
        InstrumentKey underlying, DateOnly matDate, TimeSpan timeout, CancellationToken cancellationToken) =>
        WithOptionGateAsync(async () =>
        {
            var xml = await SendOptionCommandAsync(
                BuildSecurityCommand("get_family_strikes", underlying, matDate),
                TransaqOptionXml.IsFamilyStrikes,
                timeout,
                cancellationToken).ConfigureAwait(false);
            return (IReadOnlyList<OptionStrikeQuote>)(xml is null ? [] : TransaqOptionXml.ParseStrikes(xml));
        }, cancellationToken);

    /// <inheritdoc />
    public Task<OptionLoadCommandResult> GetOptionsAsync(
        IReadOnlyList<string> optCodes, TimeSpan timeout, CancellationToken cancellationToken) =>
        WithOptionGateAsync(async () =>
        {
            if (optCodes.Count == 0)
            {
                return new OptionLoadCommandResult(false, false, false, null, "Пустой список opt_code");
            }

            var sb = new StringBuilder("<command id=\"get_options\">");
            foreach (var code in optCodes)
            {
                sb.Append("<opt_code>").Append(SecurityElement.Escape(code)).Append("</opt_code>");
            }

            sb.Append("</command>");

            bool Match(string xml) =>
                TransaqOptionXml.IsSecurities(xml) || TransaqOptionXml.IsOptionsFailed(xml);

            string? commandXml;
            try
            {
                commandXml = SendCommandRaw(sb.ToString());
                if (!IsCommandSuccess(commandXml))
                {
                    return new OptionLoadCommandResult(
                        false, false, false, commandXml,
                        ExtractCommandMessage(commandXml) ?? "get_options success=false");
                }
            }
            catch (InvalidOperationException ex)
            {
                return new OptionLoadCommandResult(false, false, false, null, ex.Message);
            }

            var callback = await WaitOptionXmlAsync(Match, timeout, cancellationToken).ConfigureAwait(false);
            if (callback is null)
            {
                return new OptionLoadCommandResult(
                    true, false, false, null,
                    $"get_options принят, колбэк за {timeout.TotalSeconds:0} с не пришёл");
            }

            if (TransaqOptionXml.IsOptionsFailed(callback))
            {
                return new OptionLoadCommandResult(true, false, true, callback, "options_failed");
            }

            return new OptionLoadCommandResult(true, true, false, callback, "securities");
        }, cancellationToken);

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

        _messages.Writer.TryComplete();
        _linkState.Writer.TryComplete();
        _optionGate.Dispose();
    }

    private async Task<T> WithOptionGateAsync<T>(Func<Task<T>> action, CancellationToken cancellationToken)
    {
        await _optionGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!IsConnected)
            {
                throw new InvalidOperationException("Нет активного соединения с TRANSAQ");
            }

            return await action().ConfigureAwait(false);
        }
        finally
        {
            _optionGate.Release();
        }
    }

    private static string BuildSecurityCommand(string commandId, InstrumentKey key, DateOnly? matDate)
    {
        var sb = new StringBuilder()
            .Append("<command id=\"").Append(commandId).Append("\">")
            .Append("<security>")
            .Append("<board>").Append(SecurityElement.Escape(key.Board)).Append("</board>")
            .Append("<seccode>").Append(SecurityElement.Escape(key.Ticker)).Append("</seccode>")
            .Append("</security>");
        if (matDate is { } d)
        {
            sb.Append("<mat_date>").Append(TransaqOptionXml.FormatMatDate(d)).Append("</mat_date>");
        }

        return sb.Append("</command>").ToString();
    }

    private async Task<string?> SendOptionCommandAsync(
        string command, Func<string, bool> match, TimeSpan timeout, CancellationToken cancellationToken)
    {
        try
        {
            var commandXml = SendCommandRaw(command);
            if (!IsCommandSuccess(commandXml))
            {
                return null;
            }
        }
        catch (InvalidOperationException)
        {
            return null;
        }

        return await WaitOptionXmlAsync(match, timeout, cancellationToken).ConfigureAwait(false);
    }

    private async Task<string?> WaitOptionXmlAsync(
        Func<string, bool> match, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        _optionXmlMatch = match;
        _optionXmlProbe = tcs;
        try
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            linked.CancelAfter(timeout);
            return await tcs.Task.WaitAsync(linked.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return null;
        }
        finally
        {
            _optionXmlProbe = null;
            _optionXmlMatch = null;
        }
    }

    private bool OnRawData(IntPtr data)
    {
        var xml = Marshal.PtrToStringUTF8(data);
        if (xml is not null)
        {
            HandleServerStatus(xml);
            TryCompleteSecurityProbe(xml);
            TryCompleteFutPriceProbe(xml);
            TryCompleteOptionXmlProbe(xml);
            _messages.Writer.TryWrite(xml);
        }

        return true;
    }

    private void TryCompleteSecurityProbe(string xml)
    {
        var probe = _securityProbe;
        var code = _securityProbeSeccode;
        if (probe is null || string.IsNullOrEmpty(code) || probe.Task.IsCompleted)
        {
            return;
        }

        // Колбэк get_securities_info приходит как sec_info / sec_info_upd / securities.
        if (xml.Contains(code, StringComparison.OrdinalIgnoreCase)
            && (xml.Contains("sec_info", StringComparison.OrdinalIgnoreCase)
                || xml.Contains("<securities", StringComparison.OrdinalIgnoreCase)
                || xml.Contains("<security", StringComparison.OrdinalIgnoreCase)))
        {
            probe.TrySetResult(xml);
        }
    }

    private void TryCompleteFutPriceProbe(string xml)
    {
        var probe = _futPriceProbe;
        var code = _futPriceSeccode;
        if (probe is null || string.IsNullOrEmpty(code) || probe.Task.IsCompleted)
        {
            return;
        }

        if (TransaqOptionXml.TryParseAlltradePrice(xml, code, out var price))
        {
            probe.TrySetResult(price);
        }
    }

    private void TryCompleteOptionXmlProbe(string xml)
    {
        var probe = _optionXmlProbe;
        var match = _optionXmlMatch;
        if (probe is null || match is null || probe.Task.IsCompleted)
        {
            return;
        }

        if (match(xml))
        {
            probe.TrySetResult(xml);
        }
    }

    /// <summary>
    /// Непрерывная обработка <c>server_status</c>: сигнал connect + публикация
    /// <see cref="ConnectorLinkStateChange"/> (phase 7h.3).
    /// </summary>
    private void HandleServerStatus(string xml)
    {
        if (!TransaqServerStatusParser.TryParse(xml, out var parsed))
        {
            return;
        }

        var signal = _connectedSignal;
        if (signal is not null && !signal.Task.IsCompleted)
        {
            if (string.Equals(parsed.Connected, "true", StringComparison.OrdinalIgnoreCase))
            {
                signal.TrySetResult(true);
            }
            else if (string.Equals(parsed.Connected, "error", StringComparison.OrdinalIgnoreCase))
            {
                var message = parsed.Text ?? "connection error";
                signal.TrySetException(new InvalidOperationException($"TRANSAQ connect failed: {message}"));
            }

            // connected="false" на этапе установки соединения игнорируем: ждём "true" или таймаут.
            if (!_sessionEstablished)
            {
                return;
            }
        }

        if (!_sessionEstablished)
        {
            return;
        }

        var state = TransaqServerStatusParser.ToLinkState(parsed);
        var at = DateTimeOffset.UtcNow;
        IsConnected = state is ConnectorLinkState.Live or ConnectorLinkState.Degraded;
        Console.WriteLine(
            $"[LinkDetect] server_status connected={parsed.Connected} recover={parsed.Recover} " +
            $"→ {state} (prev={_currentLinkState}) at={at:HH:mm:ss.fff} text={parsed.Text}");
        PublishLinkState(state, at, parsed.Text);
    }

    private void PublishLinkState(ConnectorLinkState state, DateTimeOffset at, string? detail = null)
    {
        if (_currentLinkState == state)
        {
            return;
        }

        var prev = _currentLinkState;
        _currentLinkState = state;
        Console.WriteLine(
            $"[LinkDetect] PublishLinkState {prev}→{state} at={at:HH:mm:ss.fff} detail={detail}");
        _linkState.Writer.TryWrite(new ConnectorLinkStateChange(state, at, detail));
    }

    private static string? SendCommandRaw(string command)
    {
        var resultPtr = SendCommand(command);
        if (resultPtr == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            return Marshal.PtrToStringUTF8(resultPtr);
        }
        finally
        {
            _ = FreeMemory(resultPtr);
        }
    }

    private static bool IsCommandSuccess(string? resultXml)
    {
        if (string.IsNullOrWhiteSpace(resultXml))
        {
            // Пустой/нулевой ответ DLL обычно означает успех (как в EnsureSuccess).
            return true;
        }

        try
        {
            var document = XDocument.Parse(resultXml);
            var success = document.Root?.Attribute("success")?.Value;
            return !string.Equals(success, "false", StringComparison.OrdinalIgnoreCase);
        }
        catch (System.Xml.XmlException)
        {
            return true;
        }
    }

    private static string? ExtractCommandMessage(string? resultXml)
    {
        if (string.IsNullOrWhiteSpace(resultXml))
        {
            return null;
        }

        try
        {
            var document = XDocument.Parse(resultXml);
            return (string?)document.Root?.Element("message");
        }
        catch (System.Xml.XmlException)
        {
            return resultXml;
        }
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
            if (name != NativeDll)
            {
                return IntPtr.Zero;
            }

            var resolved = ResolveDllPath(_configuredDllPath);
            return resolved is not null ? NativeLibrary.Load(resolved) : IntPtr.Zero;
        });
    }

    // DllPath может быть абсолютным или относительным. Относительный ищем сначала как есть
    // (рабочий каталог, напр. корень проекта при `dotnet run`), затем относительно каталога
    // приложения (bin/…, куда DLL копируется при сборке).
    private static string? ResolveDllPath(string? dllPath)
    {
        if (string.IsNullOrWhiteSpace(dllPath))
        {
            return null;
        }

        if (File.Exists(dllPath))
        {
            return Path.GetFullPath(dllPath);
        }

        if (!Path.IsPathRooted(dllPath))
        {
            var candidate = Path.Combine(AppContext.BaseDirectory, dllPath);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
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
