# ny_ny_intern
[![CI](https://github.com/G-A-Hagemanns-Kollegium/ny_ny_intern/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/G-A-Hagemanns-Kollegium/ny_ny_intern/actions/workflows/ci.yml)


## Kom i gang (udvikling)

```sh
task install     # opret virtualenv + installer afhængigheder
task db:up       # start Postgres + MariaDB i Docker
task seed        # fyld databasen med realistisk falsk demo-data
task dev         # kør udviklingsserveren
```

`task seed` genererer deterministisk demo-data (beboere, værelser, AK, ølkælder,
ansøgninger m.m.), så nye udviklere ser en udfyldt side med det samme. Kommandoen
kan køres igen når som helst (`--fresh` rydder først). Logins (kodeord `demo1234`):

| Email | Adgang |
|-------|--------|
| `admin@gahk.dk` | superbruger (alt) |
| `formand@gahk.dk` | administrator-rolle |
| `ak@gahk.dk` | AK-rolle |
| `oel@gahk.dk` | Ølkælder-rolle |
| `beboer@gahk.dk` | almindelig beboer |

## Test

```sh
task test:pg      # kør testsuiten mod Postgres (som CI); kræver `task db:up`
task test:sqlite  # kør testsuiten mod SQLite (uden Docker)
```
