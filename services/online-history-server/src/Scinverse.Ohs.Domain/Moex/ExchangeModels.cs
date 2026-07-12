namespace Scinverse.Ohs.Domain.Moex;

/// <summary>Торговая система MOEX (движок): <c>stock</c>, <c>futures</c>, <c>currency</c>, …</summary>
public sealed record IssEngine(string Name, string Title);

/// <summary>Рынок движка (напр. <c>shares</c>, <c>forts</c>).</summary>
public sealed record IssMarket(string Name, string Title);

/// <summary>Режим торгов (борд) рынка.</summary>
public sealed record IssBoard(string BoardId, string Title, bool IsTraded);

/// <summary>Торгуемый инструмент борда (статика из блока <c>securities</c>).</summary>
public sealed record IssSecurity(
    string SecId,
    string? ShortName,
    string? Name,
    decimal? MinStep,
    int? LotSize,
    short? Decimals,
    string? AssetCode);

/// <summary>Минимальная ссылка на FORTS-фьючерс для классификации: SECID + код базового актива.</summary>
public sealed record IssFuturesRef(string SecId, string? AssetCode, string? ShortName);
