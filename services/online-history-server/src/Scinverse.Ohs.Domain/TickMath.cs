namespace Scinverse.Ohs.Domain;

/// <summary>Конвертация цены между денежным представлением и «шагами» (ticks).</summary>
public static class TickMath
{
    /// <summary>price → ticks: round(price / minStep).</summary>
    public static long ToTicks(decimal price, decimal minStep)
    {
        if (minStep <= 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(minStep), minStep, "min_step должен быть >0");
        }

        return (long)Math.Round(price / minStep, MidpointRounding.AwayFromZero);
    }

    /// <summary>ticks → price: ticks * minStep.</summary>
    public static decimal ToPrice(long ticks, decimal minStep) => ticks * minStep;
}
