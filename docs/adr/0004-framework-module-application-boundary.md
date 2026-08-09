# ADR-0004: Keretrendszer, modul és alkalmazás határa

- Állapot: elfogadva
- Dátum: 2026-08-09

## Döntés

A SynAIus egyetlen forráskódú, több alkalmazást kiszolgáló keretrendszer. A Studio a semleges referenciaalkalmazás, az OperAI pedig ugyanennek a keretrendszernek egy külön alkalmazásmanifesttel és később OperAI-specifikus modulokkal összeállított fogyasztója. Nem tartunk fenn két másolt munkaterület-felületet.

A függőségi irány kötelező:

1. `packages/*` csak más keretrendszercsomagoktól függhet.
2. `modules/*` keretrendszercsomagoktól és más, kifejezetten engedélyezett moduloktól függhet, alkalmazástól nem.
3. `apps/*` keretrendszercsomagokat és modulokat állíthat össze, más alkalmazást nem importálhat.

Az alkalmazásidentitás, a tárhelynévtér, a kezdő munkaterület és a bekapcsolt modulok verziózott alkalmazásmanifestben vannak. A doboz tartalma külön, azonosítható `ContentInstance`; megjelenítését típus és renderer-verzió alapján regisztrált renderer végzi. A doboz geometriája és tartalma ezért egymástól függetlenül migrálható.

A fordítási kulcsok tulajdonosi névterei: `core.*`, `workspace.*`, `module.<modulId>.*`, `app.<alkalmazásId>.*`. Fejlesztéskor továbbra is kizárólag a `locales/hu.json` fájl a forrás.

## Következmények

- Az OperAI átépítése fokozatos modulbevezetéssel történhet a stabil Studio mellett.
- Egy későbbi külön OperAI repository a publikus csomagszerződések fogyasztója lehet kódmásolás nélkül.
- Az alkalmazások helyi állapota külön tárhelynévtérben marad.
- Minden új modulhoz explicit jogosultság-, tartalomtípus- és nyelvi névtér tartozik.
