using System.Globalization;
using System.Text;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Генератор синтетических XML-фрагментов TRANSAQ (securities + alltrades)
/// для демо-прогона конвейера без реального коннектора.
/// </summary>
internal static class SampleData
{
    public static IEnumerable<string> Generate(OhsOptions options)
    {
        var instruments = options.Instruments.Count > 0
            ? options.Instruments
            : [new InstrumentRef { Seccode = "SBER", Board = "TQBR" }];

        var fragments = new List<string> { BuildSecurities(instruments) };

        var random = new Random(20260701);
        var start = new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Unspecified);
        long tradeNo = 1;

        foreach (var instrument in instruments)
        {
            var price = 100.00m;
            var builder = new StringBuilder("<alltrades>");

            for (var i = 0; i < 500; i++)
            {
                price += (random.Next(-3, 4)) * 0.01m;
                var time = start.AddMilliseconds(i * 200).ToString("dd.MM.yyyy HH:mm:ss.fff", CultureInfo.InvariantCulture);
                var side = random.Next(2) == 0 ? "B" : "S";

                builder
                    .Append("<trade>")
                    .Append("<tradeno>").Append(tradeNo++).Append("</tradeno>")
                    .Append("<board>").Append(instrument.Board).Append("</board>")
                    .Append("<seccode>").Append(instrument.Seccode).Append("</seccode>")
                    .Append("<time>").Append(time).Append("</time>")
                    .Append("<price>").Append(price.ToString(CultureInfo.InvariantCulture)).Append("</price>")
                    .Append("<quantity>").Append(random.Next(1, 50)).Append("</quantity>")
                    .Append("<buysell>").Append(side).Append("</buysell>")
                    .Append("</trade>");
            }

            builder.Append("</alltrades>");
            fragments.Add(builder.ToString());
        }

        return fragments;
    }

    private static string BuildSecurities(IEnumerable<InstrumentRef> instruments)
    {
        var builder = new StringBuilder("<securities>");
        foreach (var instrument in instruments)
        {
            builder
                .Append("<security secid=\"1\">")
                .Append("<seccode>").Append(instrument.Seccode).Append("</seccode>")
                .Append("<board>").Append(instrument.Board).Append("</board>")
                .Append("<market>1</market>")
                .Append("<shortname>").Append(instrument.Seccode).Append("</shortname>")
                .Append("<decimals>2</decimals>")
                .Append("<minstep>0.01</minstep>")
                .Append("<lotsize>10</lotsize>")
                .Append("<point_cost>1</point_cost>")
                .Append("<sectype>SHARE</sectype>")
                .Append("</security>");
        }

        builder.Append("</securities>");
        return builder.ToString();
    }
}
