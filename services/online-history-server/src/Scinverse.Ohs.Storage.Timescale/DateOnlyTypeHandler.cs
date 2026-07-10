using System.Data;
using Dapper;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>
/// Маппинг <see cref="DateOnly"/> ↔ PostgreSQL <c>date</c> для Dapper (в его тип-карте
/// <see cref="DateOnly"/> отсутствует). Параметр отдаём как <see cref="DateTime"/> с
/// <see cref="DbType.Date"/>; при чтении принимаем и <see cref="DateOnly"/>, и <see cref="DateTime"/>.
/// </summary>
internal sealed class DateOnlyTypeHandler : SqlMapper.TypeHandler<DateOnly>
{
    public static void Register() => SqlMapper.AddTypeHandler(new DateOnlyTypeHandler());

    public override void SetValue(IDbDataParameter parameter, DateOnly value)
    {
        parameter.DbType = DbType.Date;
        parameter.Value = value.ToDateTime(TimeOnly.MinValue);
    }

    public override DateOnly Parse(object value) => value switch
    {
        DateOnly date => date,
        DateTime dateTime => DateOnly.FromDateTime(dateTime),
        string text => DateOnly.Parse(text, System.Globalization.CultureInfo.InvariantCulture),
        _ => throw new DataException($"Не могу привести {value.GetType()} к DateOnly")
    };
}
