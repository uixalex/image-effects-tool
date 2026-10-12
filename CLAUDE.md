# Image Effects Tool: brief

Generativni alat za efekte na slikama i videu (creative coding). Korisnik ubaci sliku ili video, primijeni jedan ili više efekata kao slojeve, podesi boje i animaciju, i izveze sliku ili video. Deploy na Vercel.

## Kako radimo

- Komunikacija na bosanskom/srpskom, direktno i neformalno.
- UI tekst je na engleskom (komunikacija ostaje na bosanskom/srpskom).
- Bez em crtica (—) u UI tekstu.
- Ne dodavati funkcije koje nisu u ovom briefu bez pitanja.
- Gradi se **u fazama**. Nakon svake faze stani, pokreni dev server, objasni šta je urađeno i čekaj odobrenje prije sljedeće faze.
- Ako nešto nije jasno ili postoji više dobrih rješenja, pitaj prije nego što gradiš.

## Tehnika

- Vite + vanilla TypeScript (ili React ako se pokaže potrebnim za panel), WebGL za renderovanje u realnom vremenu.
- Efekti koji su prirodno vektorski (ASCII, circle packing, dot overlay, HUD) mogu se crtati i na Canvas 2D ili SVG, bitno je da preview radi glatko.
- Arhitektura je **modularna**: svaki efekat je zaseban modul (svoj fajl/folder) sa:
  - definicijom parametara (iz koje se automatski generišu kontrole u panelu)
  - render funkcijom
  - motion funkcijom (kako se animira kroz vrijeme)
  - opcionalnim SVG exportom
- Dodavanje novog efekta kasnije = novi modul + registracija, bez diranja ostatka koda.
- Projekat mora raditi na Vercelu bez dodatnog podešavanja (`npm run build`, statički output).

## Reference

Sve reference su u folderu `references/`. Pogledaj ih prije pravljenja svakog efekta.

| Fajl | Šta prikazuje |
|---|---|
| `01-ascii-tamni-plus-x.png` | ASCII na crnoj pozadini, znakovi `+ × - |` i slični, bijeli |
| `02-gradient-map-cvijece.png` | Gradient map: tamno zelena, narandžasta, lila, bijela, uz blur, grain i svijetle ivice |
| `03-kompozit-zone-hud.png` | Više efekata u zonama na jednoj slici + HUD sloj (labele C2, S02, koordinate, isprekidane linije, tačke na uglovima, mrežne tačke u pozadini) |
| `04-halftone-kvadrati.png` | Mreža kvadratića čija veličina zavisi od svjetline, plava pozadina |
| `05-ascii-svijetli-vx.png` | ASCII na bijeloj pozadini, znakovi `V X # @ % = + -` |
| `06-circle-packing.png` | Krugovi različitih veličina pakovani unutar oblika, samo obrisi, crna pozadina |
| `07-pixel-mozaik-brojevi.png` | Sivi kvadrati (pikselizacija), neki sa upisanom cifrom vrijednosti |
| `08-dot-overlay.png` | Tačkice različitih veličina preko originalne fotke, prate konture |

## Efekti (moduli)

1. **ASCII**: mreža ćelija, svjetlina ćelije mapira se na znak. Kontrole: veličina ćelije, set znakova (korisnik upisuje svoj), font, invert, boja znakova, boja pozadine, opcija da znakovi uzmu boju iz slike ili gradijenta.
2. **Gradient Map**: svjetlina se mapira na gradijent. Kontrole: gradient editor, blur, grain (količina i veličina), glow/svijetle ivice, kontrast.
3. **Halftone kvadrati**: veličina kvadrata po svjetlini. Kontrole: veličina ćelije, min/max veličina, oblik (kvadrat, krug), boje, invert.
4. **Circle packing**: krugovi pakovani u oblast (svjetlije ili tamnije od praga). Kontrole: min/max radijus, gustina, debljina linije, ispuna ili obris, boje.
5. **Pixel mozaik sa brojevima**: pikselizacija u sive (ili obojene) kvadrate, na dijelu ćelija ispisana cifra vrijednosti. Kontrole: veličina ćelije, procenat ćelija sa brojem, font, boje.
6. **Dot overlay**: tačke preko originalne slike, raspoređene po konturama/ivicama i svjetlini. Kontrole: gustina, min/max veličina, osjetljivost na ivice, boja tačaka, blend mode.
7. **HUD sloj**: dekorativni sloj preko svega. Labele (tekst tipa `S02`), koordinate, isprekidane linije, kvadratne tačke na uglovima zona, pozadinska tačkasta mreža. Labele i koordinate mogu se automatski vezati za zone.

## Primjena efekata (gdje se efekat vidi)

Svaki efekat je **sloj sa svojom maskom**. Maska može biti:

- **Cijela slika** (default)
- **Threshold po svjetlini**: efekat samo gdje je slika svjetlija ili tamnija od praga (slajder + invert)
- **Zone**: pravougaonici koje korisnik crta na canvasu, pomjera i mijenja veličinu
- **Četkica**: crtanje maske, gumica, veličina i mekoća četke

Maske se mogu kombinovati (npr. zona + doraditi četkicom). Slojevi: dodaj, obriši, sakrij, promijeni redoslijed, opacity, blend mode. Efekti se koriste pojedinačno ili složeni jedan preko drugog.

## Boje (Figma stil)

- Color picker: kvadrat za saturaciju/svjetlinu, hue slajder, hex polje, opacity, eyedropper sa slike
- Gradient editor: traka sa tačkama (stops), klik dodaje tačku, prevlačenje pomjera, brisanje, svaka tačka ima svoju boju
- Čuvanje paleta i gradijenata kao presete (localStorage)

## Motion

Svaki efekat ima svoju animaciju, uključivu po želji:

- ASCII: treperenje, scramble znakova, talas kroz mrežu
- Gradient Map: klizanje palete, živi grain, pulsiranje blura
- Halftone, circle packing, dot overlay: disanje veličine, talas, šum
- Pixel mozaik: brojevi koji se mijenjaju
- HUD: koordinate koje se ažuriraju, treptanje labela

Kontrole: brzina, intenzitet, **loop** (animacija trajanja X sekundi koja se savršeno ponavlja) ili **slobodno**.

## Input

- Slika (PNG, JPG, WEBP), drag & drop ili dugme
- Video (MP4, WebM, MOV gdje browser podržava): efekat se primjenjuje na svaki frame

## Export

- **Slika**: PNG, JPG, SVG (za vektorske efekte)
- **Video**: MP4 i WebM, izbor trajanja, FPS i rezolucije
- **GIF** za kratke loop-ove
- Format platna: Original, 1:1, 4:5, 16:9, 9:16
- Video export preko WebCodecs + muxer biblioteke (fallback MediaRecorder ako treba)

## UI

- Lijevo: lista slojeva
- Sredina: canvas sa previewom u realnom vremenu, zoom i pan
- Desno: kontrole aktivnog sloja
- Gore ili dole: format platna, play/pause animacije, export
- Tamna tema, čist, minimalan izgled

## Faze

**Faza 1: osnova**
Vite projekat, upload slike, sistem slojeva, svih 6 efekata + HUD sa osnovnim kontrolama, color picker i gradient editor, PNG export, formati platna.

**Faza 2: maske**
Threshold, zone, četkica sa gumicom, kombinovanje maski po sloju.

**Faza 3: motion i video**
Animacije po efektu, loop i slobodno, video kao input, export u MP4, WebM i GIF, SVG export.

**Faza 4: dorada**
Presete paleta i efekata, performanse za velike slike i video, deploy na Vercel.
