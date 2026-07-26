# PlantUML для превью C4 в Cursor

Плагин `jebbs.plantuml` тащит в комплекте **PlantUML 1.2021.00** — его мало для современного
C4-stdlib (`%chr`, `?=` …). В репозитории используем актуальный jar.

## Установка jar

```powershell
# из корня репо
New-Item -ItemType Directory -Force -Path tools/plantuml | Out-Null
Invoke-WebRequest `
  -Uri "https://github.com/plantuml/plantuml/releases/download/v1.2025.2/plantuml-1.2025.2.jar" `
  -OutFile "tools/plantuml/plantuml.jar"
java -jar tools/plantuml/plantuml.jar -version
```

Нужны **Java 11+** и **Graphviz** (`dot` в PATH) — для Local-рендера.

## Cursor / VS Code

Workspace (`.vscode/settings.json`):

- `plantuml.render` = `Local`
- `plantuml.jar` = `tools/plantuml/plantuml.jar`

Превью: открыть `.puml` → `Alt+D`. После смены jar — Reload Window.

Jar в git **не** коммитится (см. `.gitignore`); каждый клонирует через команду выше.
