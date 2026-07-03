using System.Reflection;
using DbUp;
using DbUp.Engine;

namespace Scinverse.Db.Migrator;

/// <summary>
/// Прогон SQL-миграций (DbUp) из встроенных ресурсов сборки.
/// Скрипты — упорядоченные db/migrations/V*.sql (embedded).
/// </summary>
public static class DatabaseMigrator
{
    public static DatabaseUpgradeResult Run(string connectionString)
    {
        EnsureDatabase.For.PostgresqlDatabase(connectionString);

        var upgrader = DeployChanges.To
            .PostgresqlDatabase(connectionString)
            .WithScriptsEmbeddedInAssembly(Assembly.GetExecutingAssembly())
            .LogToConsole()
            .Build();

        return upgrader.PerformUpgrade();
    }
}
