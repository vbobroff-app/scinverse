using System.Globalization;
using System.Text.Json;

namespace Scinverse.Ohs.Domain.Moex;

/// <summary>
/// Разбор табличного формата MOEX ISS: <c>{ "&lt;table&gt;": { "columns": [...], "data": [[...], ...] } }</c>.
/// Универсальный маппер — по имени колонки (регистронезависимо) достаём ячейку строки.
/// Значения клонируются, поэтому таблица переживает освобождение исходного <see cref="JsonDocument"/>.
/// </summary>
public sealed class IssTable
{
    private static readonly IssTable EmptyTable = new(new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase), []);

    private readonly Dictionary<string, int> _columns;
    private readonly IReadOnlyList<JsonElement[]> _rows;

    private IssTable(Dictionary<string, int> columns, IReadOnlyList<JsonElement[]> rows)
    {
        _columns = columns;
        _rows = rows;
    }

    /// <summary>Число строк данных.</summary>
    public int Count => _rows.Count;

    /// <summary>Строки таблицы как типизированные обёртки.</summary>
    public IEnumerable<IssRow> Rows
    {
        get
        {
            foreach (var row in _rows)
            {
                yield return new IssRow(_columns, row);
            }
        }
    }

    /// <summary>Разбирает таблицу <paramref name="table"/> из JSON-строки ISS-ответа.</summary>
    public static IssTable Parse(string json, string table)
    {
        using var document = JsonDocument.Parse(json);
        return Parse(document.RootElement, table);
    }

    /// <summary>Разбирает таблицу <paramref name="table"/> из корневого элемента ISS-ответа.</summary>
    public static IssTable Parse(JsonElement root, string table)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(table, out var block)
            || block.ValueKind != JsonValueKind.Object)
        {
            return EmptyTable;
        }

        var columns = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        if (block.TryGetProperty("columns", out var cols) && cols.ValueKind == JsonValueKind.Array)
        {
            var i = 0;
            foreach (var col in cols.EnumerateArray())
            {
                var name = col.GetString();
                if (!string.IsNullOrEmpty(name))
                {
                    columns[name] = i;
                }

                i++;
            }
        }

        var rows = new List<JsonElement[]>();
        if (block.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
        {
            foreach (var row in data.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                var cells = new List<JsonElement>();
                foreach (var cell in row.EnumerateArray())
                {
                    cells.Add(cell.Clone());
                }

                rows.Add([.. cells]);
            }
        }

        return new IssTable(columns, rows);
    }
}

/// <summary>Строка ISS-таблицы: доступ к ячейкам по имени колонки с приведением типов.</summary>
public readonly struct IssRow(Dictionary<string, int> columns, JsonElement[] values)
{
    /// <summary>Строковое значение колонки (числа приводятся к строке); <c>null</c> при отсутствии/Null.</summary>
    public string? GetString(string column)
    {
        if (!TryGet(column, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null,
        };
    }

    /// <summary>Целочисленное значение колонки; <c>null</c> при отсутствии/непарсимости.</summary>
    public int? GetInt(string column)
    {
        if (!TryGet(column, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var n) => n,
            JsonValueKind.String when int.TryParse(
                value.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Дробное значение колонки; <c>null</c> при отсутствии/непарсимости.</summary>
    public decimal? GetDecimal(string column)
    {
        if (!TryGet(column, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDecimal(out var n) => n,
            JsonValueKind.String when decimal.TryParse(
                value.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Булево значение колонки: <c>1</c>/<c>"1"</c>/<c>true</c> → true.</summary>
    public bool GetBool(string column)
    {
        if (!TryGet(column, out var value))
        {
            return false;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.Number when value.TryGetInt32(out var n) => n != 0,
            JsonValueKind.String => value.GetString() is "1" or "true" or "TRUE",
            _ => false,
        };
    }

    private bool TryGet(string column, out JsonElement value)
    {
        if (columns.TryGetValue(column, out var index) && index < values.Length)
        {
            value = values[index];
            return value.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined);
        }

        value = default;
        return false;
    }
}
