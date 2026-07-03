using Scinverse.Db.Migrator;

var connectionString =
    args.FirstOrDefault()
    ?? Environment.GetEnvironmentVariable("SCINVERSE_DB")
    ?? "Host=localhost;Port=5432;Database=scinverse;Username=scinverse;Password=scinverse";

Console.WriteLine("Scinverse DB migrator — запуск миграций...");

var result = DatabaseMigrator.Run(connectionString);

if (!result.Successful)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.Error.WriteLine(result.Error);
    Console.ResetColor();
    return 1;
}

Console.ForegroundColor = ConsoleColor.Green;
Console.WriteLine("Миграции применены успешно.");
Console.ResetColor();
return 0;
