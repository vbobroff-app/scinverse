namespace Scinverse.Ohs.Domain;

/// <summary>Набор инструментов (basket) в scope connection.</summary>
public sealed record InstrumentBasket
{
    public required long BasketId { get; init; }

    public required long ConnectionId { get; init; }

    public required BasketKind Kind { get; init; }

    public required string Name { get; init; }

    /// <summary>Стабильный id system-набора (<c>recording</c>, <c>has_data</c>, …).</summary>
    public string? SystemId { get; init; }

    public required bool Enabled { get; init; }

    /// <summary>Правила static; у system/dynamic без materialize rule — null.</summary>
    public BasketRule? Rule { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }
}
