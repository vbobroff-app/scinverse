using FluentAssertions;
using Scinverse.Ohs.Domain.Moex;

namespace Scinverse.Ohs.UnitTests;

public sealed class IssTableTests
{
    // Формат ISS с iss.meta=off: { "<table>": { "columns": [...], "data": [[...], ...] } }.
    private const string EnginesJson = """
        {"engines":{"columns":["id","name","title"],
         "data":[[1,"stock","Фондовый рынок"],[2,"futures","Срочный рынок"],[3,"currency","Валютный рынок"]]}}
        """;

    private const string BoardsJson = """
        {"boards":{"columns":["id","boardid","title","is_traded"],
         "data":[[177,"TQBR","Т+: Акции и ДР",1],[58,"EQBR","Основной режим",0]]}}
        """;

    private const string SecuritiesJson = """
        {"securities":{"columns":["SECID","SHORTNAME","SECNAME","MINSTEP","LOTSIZE","DECIMALS"],
         "data":[["SBER","Сбербанк","Сбербанк ПАО ао",0.01,10,2],
                 ["GAZP","ГАЗПРОМ ао",null,"0.01",10,2]]}}
        """;

    [Fact]
    public void Parse_Engines_ReadsColumnsByName()
    {
        var table = IssTable.Parse(EnginesJson, "engines");

        table.Count.Should().Be(3);
        var rows = table.Rows.ToList();
        rows[0].GetString("name").Should().Be("stock");
        rows[0].GetString("title").Should().Be("Фондовый рынок");
        rows[1].GetString("name").Should().Be("futures");
    }

    [Fact]
    public void Parse_Boards_ReadsBoolAndMissingColumnSafely()
    {
        var table = IssTable.Parse(BoardsJson, "boards");
        var rows = table.Rows.ToList();

        rows[0].GetString("boardid").Should().Be("TQBR");
        rows[0].GetBool("is_traded").Should().BeTrue();
        rows[1].GetBool("is_traded").Should().BeFalse();
        rows[0].GetString("nonexistent").Should().BeNull();
    }

    [Fact]
    public void Parse_Securities_CoercesNumbersAndHandlesNulls()
    {
        var table = IssTable.Parse(SecuritiesJson, "securities");
        var rows = table.Rows.ToList();

        rows[0].GetString("SECID").Should().Be("SBER");
        rows[0].GetDecimal("MINSTEP").Should().Be(0.01m);
        rows[0].GetInt("LOTSIZE").Should().Be(10);
        rows[0].GetInt("DECIMALS").Should().Be(2);

        // Число, записанное строкой ("0.01") — тоже парсится.
        rows[1].GetDecimal("MINSTEP").Should().Be(0.01m);
        // Null-ячейка → null.
        rows[1].GetString("SECNAME").Should().BeNull();
    }

    [Fact]
    public void Parse_MissingTable_ReturnsEmpty()
    {
        var table = IssTable.Parse("""{"other":{"columns":[],"data":[]}}""", "engines");
        table.Count.Should().Be(0);
        table.Rows.Should().BeEmpty();
    }

    [Fact]
    public void Parse_ColumnLookup_IsCaseInsensitive()
    {
        var table = IssTable.Parse(EnginesJson, "engines");
        var row = table.Rows.First();

        row.GetString("NAME").Should().Be("stock");
        row.GetString("Title").Should().Be("Фондовый рынок");
    }
}
