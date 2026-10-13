# OLYCITY 1.0.10 — Correctif serveur

1. Arrêter le serveur dans Crafty et conserver une sauvegarde du monde.
2. Dans le terminal Linux, ouvrir le dossier du serveur et lancer avec le même compte que Crafty :

```sh
sh olycity-update.sh 1.0.10 --serveur-arrete
```

3. Relancer le serveur dans Crafty avec Java 17, attendre « Done », puis rejoindre.

Les joueurs ferment Minecraft puis relancent leur instance Prism habituelle ; Packwiz récupère le correctif. Aucune réimportation de ZIP nécessaire.

Ce correctif conserve Champions et corrige le crash sur les dégâts sans attaquant. Il inclut les changements de la 1.0.9, dont le retrait de Rats.
