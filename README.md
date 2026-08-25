# Profi-Planung OS – PWA

Direkt im iPhone-Safari nutzbare Progressive Web App.

## Enthalten

- lokale Projektspeicherung via `localStorage`
- Lastgang:
  - CSV/TXT Import (`timestamp;kw`, `timestamp;kwh`)
  - JSON-Projektimport
  - Industrie 1/2/3-Schicht
  - Gewerbe
  - Maststall mit Einstallungs-/Mastphasen
- PV:
  - mehrere Dächer
  - je Dach Breite/Tiefe/Neigung/Azimut/Nutzfaktor
  - kWp je Dach manuell oder über Modulfelder
  - Gesamt-kWp Override
  - Wechselrichter
- Speicher:
  - Eigenverbrauch
  - Peakshaving
  - Eigenverbrauch + Peakshaving
  - Arbitrage
  - Kombibetrieb
  - Empfehlung + Variantenvergleich
- Ladeinfrastruktur:
  - mehrere AC/DC Gruppen
  - PKW/Transporter/LKW Fuhrpark
  - Ladeleistungs-/Energievergleich
- Prognose:
  - Open-Meteo je Dach mit `global_tilted_irradiance`, Neigung und Azimut
  - Kurzfrist-PV-Prognose je Dach und gesamt
- Wirtschaftlichkeit:
  - PV-/Speicher-CAPEX
  - OPEX
  - Eigenverbrauch / Einspeisung
  - Peakshaving
  - Arbitrage
  - THG-Ansatz
  - Diesel→EV Kostenvorteil
  - Amortisationszeit
  - Cashflow
- Bericht:
  - Browser-Druck als PDF
  - JSON-Projektexport/-import

## Warum Jahresamortisation und Wetter getrennt sind

Die aktuelle Wetterprognose betrifft nur die kommenden Tage. Sie wird deshalb für die kurzfristige PV-Produktion genutzt.
Der Jahresertrag für die Amortisation basiert auf:

`kWp je Dach × spezifischer Jahresertrag × Ausrichtungsfaktor`

So wird nicht eine einzelne Wetterwoche auf ein volles Jahr hochgerechnet.

## Lokal testen

Ein Service Worker funktioniert nicht zuverlässig über `file://`. Nutze einen kleinen Webserver:

```bash
python3 -m http.server 8080
```

Dann: `http://localhost:8080`

## Kostenlos über GitHub Pages veröffentlichen

1. Neues GitHub Repository anlegen.
2. Inhalt dieses Ordners in die Root des Repositories hochladen.
3. GitHub → Settings → Pages.
4. `Deploy from a branch` wählen.
5. Branch `main`, Ordner `/ (root)`.
6. Die erzeugte HTTPS-Adresse in Safari auf dem iPhone öffnen.
7. Safari → Teilen → **Zum Home-Bildschirm**.

Danach startet Profi-Planung OS im Standalone-Modus wie eine App.

## Datenschutz

Projektangaben werden lokal im Browser gespeichert. Nur beim Abruf der Wetterprognose werden Standortkoordinaten an die Open-Meteo-API übertragen.

## Hinweis

Die PWA ist ein technisches Vorplanungstool. Netzanschluss, Schutzkonzept, Herstellerfreigaben, Tarife, THG-Regeln und regulatorische Anforderungen projektbezogen verifizieren.


## Energiepreise & Fuhrpark (v2)

- Strompreis manuell oder optional über Fraunhofer ISE Energy-Charts Day-Ahead (`/price`, DE-LU)
- Netz-/Steuer-/Lieferaufschlag separat einstellbar
- Spritpreise manuell oder optional über Tankerkönig/MTS-K
- Tankerkönig API-Key wird nur lokal im Browser gespeichert und nicht in GitHub hinterlegt
- Kraftstoffe: Diesel, Super E10, Super E5
- Fuhrparkgruppen: PKW, Transporter, LKW
- EV-Verbrauch kWh/100 km und Verbrennerverbrauch L/100 km vollständig manuell überschreibbar
- Vergleich: EV-Energie, Kraftstoffmenge, Stromkosten, Kraftstoffkosten, Betriebskostenvorteil, THG
- Ladeinfrastruktur bleibt getrennt nach AC/DC und Leistung/Anzahl
