namespace Scinverse.Ohs.Domain;

/// <summary>Один инструмент, добавленный/убранный из static basket при re-eval.</summary>
public sealed record BasketMemberChange(
    long BasketId,
    string BasketName,
    long InstrumentId,
    string Label);

/// <summary>Дельта members после re-eval static baskets.</summary>
public sealed record BasketEvalDelta(
    IReadOnlyList<BasketMemberChange> Added,
    IReadOnlyList<BasketMemberChange> Removed)
{
    public static BasketEvalDelta Empty { get; } = new([], []);

    public BasketEvalDelta Merge(BasketEvalDelta other)
    {
        ArgumentNullException.ThrowIfNull(other);
        if (other.Added.Count == 0 && other.Removed.Count == 0)
        {
            return this;
        }

        if (Added.Count == 0 && Removed.Count == 0)
        {
            return other;
        }

        return new BasketEvalDelta(
            [.. Added, .. other.Added],
            [.. Removed, .. other.Removed]);
    }
}
