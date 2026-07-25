using System.Diagnostics;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Safety-net (phase 7j §3.B): любое НЕперехваченное исключение → лог Serilog с requestId +
/// ProblemDetails (без стека наружу) + событие в NC. Якорь поиска — <c>requestId</c> (виден как
/// <c>corr:</c> в ленте и в логе → полный стек по нему). Две природы (nc-availability.md §6.1):
/// <list type="bullet">
/// <item><b>Транспортный шум</b> (<see cref="BadHttpRequestException"/>: оборванное/некорректное тело,
/// частая гонка при рестарте) — 400-класс, НЕ краш → <c>ohs.request_error</c> (system·<b>error</b>),
/// статус из исключения. Не FATAL, инцидент простоя не трогает.</item>
/// <item><b>Настоящее необработанное</b> — 500 → <c>ohs.unhandled</c> (system·<b>critical/fatal</b>).
/// Клиент во время активного инцидента простоя втягивает его в стек (см. web/OhsStore).</item>
/// </list>
/// </summary>
public sealed class GlobalExceptionHandler(
    INotificationPublisher notifications,
    ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        // Клиент отменил запрос — это не сбой сервера, отдаём стандартной обработке.
        if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
        {
            return false;
        }

        var requestId = Activity.Current?.Id ?? httpContext.TraceIdentifier;
        var method = httpContext.Request.Method;
        var path = httpContext.Request.Path.Value ?? string.Empty;

        // Транспортный шум: тело запроса не прочитано (обрыв на середине / рестарт-гонка / кривой JSON).
        // Это 400-класс, а не краш сервера → обычная Error (браузерный стандарт для сбоя запроса — ERROR,
        // не FATAL и не warning), статус из исключения. Инцидент простоя (клиентский) не затрагивает.
        if (exception is BadHttpRequestException bad)
        {
            logger.LogWarning(
                exception,
                "Некорректный/оборванный запрос {Method} {Path} (requestId={RequestId})",
                method, path, requestId);

            notifications.Publish(
                code: "ohs.request_error",
                message: "Ошибка обработки запроса (обрыв соединения или некорректное тело)",
                severity: "error",
                sourceType: "system",
                module: "ohs.host",
                data: new
                {
                    requestId,
                    lines = new[] { $"{method} {path}", Summarize(exception) },
                },
                correlationId: requestId);

            httpContext.Response.StatusCode = bad.StatusCode;
            await httpContext.Response.WriteAsJsonAsync(
                new ProblemDetails
                {
                    Status = bad.StatusCode,
                    Title = "Некорректный запрос",
                    Detail = "Не удалось прочитать запрос. Возможен обрыв соединения.",
                    Extensions = { ["requestId"] = requestId },
                },
                cancellationToken);

            return true;
        }

        // Полный стек — только в серверный лог (безопасность + размер), поиск по requestId.
        logger.LogError(
            exception,
            "Необработанное исключение {Method} {Path} (requestId={RequestId})",
            method, path, requestId);

        notifications.Publish(
            code: "ohs.unhandled",
            message: "Внутренняя ошибка сервера: необработанное исключение (500)",
            severity: "critical",
            sourceType: "system",
            module: "ohs.host",
            data: new
            {
                requestId,
                lines = new[] { $"{method} {path}", Summarize(exception) },
            },
            correlationId: requestId);

        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await httpContext.Response.WriteAsJsonAsync(
            new ProblemDetails
            {
                Status = StatusCodes.Status500InternalServerError,
                Title = "Внутренняя ошибка сервера",
                Detail = "Необработанное исключение. Обратитесь к администратору.",
                Extensions = { ["requestId"] = requestId },
            },
            cancellationToken);

        return true;
    }

    /// <summary>Краткая суть исключения (тип + message, усечение ≤500). Полный стек — в логе.</summary>
    private static string Summarize(Exception ex)
    {
        var summary = $"{ex.GetType().FullName}: {ex.Message}";
        return summary.Length > 500 ? summary[..500] + "…" : summary;
    }
}
