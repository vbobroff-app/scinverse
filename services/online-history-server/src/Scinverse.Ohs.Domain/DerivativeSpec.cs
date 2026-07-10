using System.Diagnostics.CodeAnalysis;

namespace Scinverse.Ohs.Domain;

/// <summary>
/// Атрибуты дериватива, выведенные из кода инструмента (MOEX FORTS): базовый актив,
/// экспирация и — для опциона — тип/страйк. Наполняет подтип-таблицу <c>derivative</c>.
/// </summary>
public sealed record DerivativeSpec
{
    /// <summary>Код базового актива для группировки (напр. <c>Si</c>, <c>RI</c>, <c>BR</c>).</summary>
    public required string UnderlyingCode { get; init; }

    /// <summary>Дата экспирации контракта.</summary>
    public required DateOnly Expiration { get; init; }

    /// <summary>'C'/'P' для опциона; <c>null</c> — фьючерс.</summary>
    public char? OptionType { get; init; }

    /// <summary>Страйк опциона; <c>null</c> — фьючерс.</summary>
    public decimal? Strike { get; init; }

    /// <summary>Для опциона — код базового фьючерса (напр. <c>SiU6</c>) для резолва underlying_id.</summary>
    public string? UnderlyingFuturesCode { get; init; }
}

/// <summary>
/// Разбирает код инструмента в <see cref="DerivativeSpec"/> по конвенциям MOEX FORTS.
/// Не бросает исключений: нераспознанный код → <c>false</c> (инструмент остаётся «плоским»).
/// </summary>
public interface IDerivativeSpecParser
{
    bool TryParse(InstrumentKey key, string? secType, DateOnly asOf, [NotNullWhen(true)] out DerivativeSpec? spec);
}
