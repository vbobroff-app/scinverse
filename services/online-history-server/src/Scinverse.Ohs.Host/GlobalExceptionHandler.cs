using System.Diagnostics;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Safety-net (phase 7j §3.B): любое НЕперехваченное исключение → лог Serilog с requestId +
/// ProblemDetails 500 (без стека наружу) + <c>ohs.unhandled</c> в NC (system·critical). Якорь
/// поиска — <c>requestId</c> (виден как <c>corr:</c> в ленте и в логе → полный стек по нему).
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
