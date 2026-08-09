# ADR-0003: Tartós thread-stream átjáró

- Állapot: elfogadva, megvalósítva
- Dátum: 2026-08-09

## Döntés

A Codex app-server integráció külön `thread-stream` modul mögött marad. A böngésző nem beszél közvetlenül az app-serverrel: egy helyi, alapértelmezetten loopback-címre kötött bridge biztosít HTTP- és SSE-szerződést.

Az app-server kapcsolat egyszeri `initialize`/`initialized` kézfogást, korrelált JSONL-kéréseket, stale-processz védelmet, kérés-időkorlátot és korlátozott exponenciális újracsatlakozást használ. A bridge minden fogadott app-server értesítést előbb SQLite-ba ír, és csak utána sugároz. Az SSE-esemény monoton kurzort kap; újracsatlakozáskor a `Last-Event-ID` vagy a lekérdezési kurzor alapján történik a visszajátszás.

A nyers reasoning-szöveg értesítését az app-server képességeinél pontos metódusnévvel kikapcsoljuk. A `thread/read` eredményéből a böngésző csak a megjelenítő számára szükséges felhasználói és ügynöküzeneteket kapja; fájlutak, teljes nyers thread-rekordok és reasoning-tartalom nem kerülnek a listázási vagy snapshot DTO-ba.

## Aktív író kezelése

A Codex App által éppen birtokolt threadre egy második app-server kliens nem kaphat írói jogot. Ha a `thread/resume` `active writer` hibát ad, a bridge nem szakítja meg a meglévő írót és nem indít második turnt. Ehelyett `thread/read` alapú, változásérzékelő megfigyelési módra vált, tartós snapshotot frissít, és kis méretű változáseseményt küld az SSE-csatornán. A portál ebben az állapotban letiltja a steer és interrupt műveleteket.

Szabad vagy a bridge által birtokolt threadnél a kapcsolat interaktív marad, és a natív app-server értesítési streamet használja.

## Következmények

- A stream a böngésző vagy a bridge rövid kiesése után kurzorról folytatható.
- A már futó Codex App-feladat megfigyelhető az aktív író megzavarása nélkül.
- Az SQLite és minden futásidejű thread-adat kizárt a Gitből.
- Több node-os elérés előtt külön hitelesítési és jogosultsági réteget kell tenni a bridge elé; a jelenlegi bridge közvetlen publikus hálózati kitettségre nem alkalmas.
- A viselkedési referencia a Conductor hibatűrő kliense és eseménymodellje volt; a bridge kódját nem másoltuk át.
