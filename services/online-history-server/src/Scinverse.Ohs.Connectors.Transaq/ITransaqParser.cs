using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>Anti-Corruption Layer: разбор XML TRANSAQ в доменные сообщения.</summary>
public interface ITransaqParser
{
    IEnumerable<IMarketMessage> Parse(string xml);
}
