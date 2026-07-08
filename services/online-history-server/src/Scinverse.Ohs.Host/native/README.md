# Нативные библиотеки коннекторов

Сюда кладутся нативные DLL коннекторов. **В git не коммитятся** (`.gitignore`: `**/native/*.dll`).

## TRANSAQ (Finam TXmlConnector)

Положить сюда файл:

- `txmlconnector64.dll` — **x64** версия (из поставки Finam `TXmlConnector\x64\`).

Хост — обычный 64-битный процесс (дефолт `dotnet run`), поэтому берём x64-библиотеку; переключать
`PlatformTarget` на x86 не нужно.

Путь к DLL указывается в `appsettings.Local.json` (`Transaq:DllPath`), по умолчанию —
`native/txmlconnector64.dll`. Файл копируется в выходной каталог при сборке; резолвер
(`TransaqConnector.EnsureResolver`) находит его относительно каталога приложения.
