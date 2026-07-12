using System.Xml.Linq;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>Разбор колбэка <c>&lt;server_status&gt;</c> TRANSAQ (phase 7h.3).</summary>
public static class TransaqServerStatusParser
{
    public sealed record ParsedStatus(string Connected, bool Recover, string? Text);

    public static bool TryParse(string xml, out ParsedStatus status)
    {
        status = default!;
        if (!xml.StartsWith("<server_status", StringComparison.Ordinal))
        {
            return false;
        }

        try
        {
            var root = XDocument.Parse(xml).Root;
            if (root is null)
            {
                return false;
            }

            var connected = root.Attribute("connected")?.Value;
            if (string.IsNullOrWhiteSpace(connected))
            {
                return false;
            }

            var recover = string.Equals(root.Attribute("recover")?.Value, "true", StringComparison.OrdinalIgnoreCase);
            var text = (string?)root.Element("text");
            status = new ParsedStatus(connected, recover, text);
            return true;
        }
        catch (System.Xml.XmlException)
        {
            return false;
        }
    }

    public static ConnectorLinkState ToLinkState(ParsedStatus status)
    {
        if (string.Equals(status.Connected, "true", StringComparison.OrdinalIgnoreCase))
        {
            return status.Recover ? ConnectorLinkState.Degraded : ConnectorLinkState.Live;
        }

        if (string.Equals(status.Connected, "error", StringComparison.OrdinalIgnoreCase))
        {
            return ConnectorLinkState.Error;
        }

        return ConnectorLinkState.Down;
    }
}
