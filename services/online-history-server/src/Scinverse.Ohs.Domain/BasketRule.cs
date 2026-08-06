namespace Scinverse.Ohs.Domain;

/// <summary>Правила static-набора: glob-паттерны по ticker (OR) + опциональные фильтры.</summary>
public sealed record BasketRule
{
    public required IReadOnlyList<string> Patterns { get; init; }

    public string? SecType { get; init; }

    public string? BoardId { get; init; }
}
