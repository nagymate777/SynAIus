# ADR-0003: Tartós thread-stream átjáró

- Állapot: elfogadva, megvalósítva
- Dátum: 2026-08-09

## Döntés

A Codex app-server integráció külön `thread-stream` modul mögött marad. A böngésző nem beszél közvetlenül az app-serverrel: egy helyi, alapértelmezetten loopback-címre kötött bridge biztosít HTTP- és SSE-szerződést.

Az app-server kapcsolat egyszeri `initialize`/`initialized` kézfogást, korrelált JSONL-kéréseket, stale-processz védelmet, kérés-időkorlátot és korlátozott exponenciális újracsatlakozást használ. A bridge minden fogadott app-server értesítést előbb SQLite-ba ír, és csak utána sugároz. Az SSE-esemény monoton kurzort kap; újracsatlakozáskor a `Last-Event-ID` vagy a lekérdezési kurzor alapján történik a visszajátszás.

A nyers reasoning-szöveg értesítését az app-server képességeinél pontos metódusnévvel kikapcsoljuk. A `thread/read` eredményéből a böngésző csak a megjelenítő számára szükséges felhasználói és ügynöküzeneteket, valamint a parancs-, fájlmódosítás-, MCP- és dinamikus eszközitemek szigorúan engedélyezett mezőit kapja. A parancskimenet, a fájlutak és diffek, illetve az eszközargumentumok és -eredmények méretkorlátos előnézetként jelenhetnek meg; a teljes nyers thread-rekord és a reasoning-tartalom nem kerül a snapshot DTO-ba.

## Aktív író kezelése

A Codex App által éppen birtokolt threadre egy második app-server kliens nem kaphat írói jogot. Ha a `thread/resume` `active writer` hibát ad, a bridge nem szakítja meg a meglévő írót és nem indít második turnt. Ehelyett `thread/read` alapú, változásérzékelő megfigyelési módra vált, tartós snapshotot frissít, és kis méretű változáseseményt küld az SSE-csatornán. A portál ebben az állapotban letiltja a steer és interrupt műveleteket.

Szabad vagy a bridge által birtokolt threadnél a kapcsolat interaktív marad, és a natív app-server értesítési streamet használja.

## Munkadoboz-műveletek

A feladatválasztó a lapozott `thread/list` szerződést és annak `searchTerm` mezőjét használja. Az új feladat űrlapja a `model/list` eredményéből épül fel; modell- vagy gondolkodási erősség nem lehet beégetve. A `thread/start` nem írja felül a helyi Codex jóváhagyási és sandbox-beállításait. Az első és a későbbi üresjárati utasítás `turn/start`, az aktív körhöz adott kiegészítés `turn/steer`.

Minden böngészős csatlakozás egy véletlen azonosítójú mellékletet kap. A stream csak ezzel az azonosítóval nyitható meg, és a feladatváltás vagy a renderer lebontása kifejezett leválasztást küld. Az utolsó melléklet megszűnésekor a bridge `thread/unsubscribe` kéréssel leválik az app-serverről, eltávolítja a tartós feliratkozást és leállítja az esetleges megfigyelői pollingot.

## Szerver által kezdeményezett interakciók

A parancsvégrehajtási, fájlmódosítási és jogosultsági jóváhagyások, valamint a felhasználói kérdések tartós függő interakcióként kerülnek SQLite-ba még a böngészős sugárzás előtt. Válasz kizárólag azon az élő app-server kapcsolaton küldhető, amelyen a kérés érkezett; újracsatlakozáskor a korábbi kapcsolat függő kérései elévülnek. A már feloldott vagy elavult kérésekre adott válasz hibával leáll.

A bridge csak az app-server által kért jogosultság pontos részhalmazát adhatja meg, és az ismeretlen szerverkéréseket automatikus engedélyezés helyett JSON-RPC hibával utasítja el. A titkos felhasználói válasz kizárólag az aktív HTTP-kérésben és az app-server válaszában szerepelhet; nem kerül eseménynaplóba vagy tartós tárba. Az MCP-elicitation jelenleg biztonságosan elutasítható vagy megszakítható; strukturált elfogadó űrlap külön későbbi bővítés.

## Következmények

- A stream a böngésző vagy a bridge rövid kiesése után kurzorról folytatható.
- A már futó Codex App-feladat megfigyelhető az aktív író megzavarása nélkül.
- Az SQLite és minden futásidejű thread-adat kizárt a Gitből.
- Több node-os elérés előtt külön hitelesítési és jogosultsági réteget kell tenni a bridge elé; a jelenlegi bridge közvetlen publikus hálózati kitettségre nem alkalmas.
- A viselkedési referencia a Conductor hibatűrő kliense és eseménymodellje volt; a bridge kódját nem másoltuk át.
