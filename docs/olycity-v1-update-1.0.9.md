# Mise à jour du serveur OLYCITY vers 1.0.9

Il suffit de mettre à jour le serveur existant. Aucun nouveau ZIP à importer.

1. Arrêter Minecraft avec le bouton **Arrêter** de Crafty et attendre la fin de l’arrêt.
2. Sauvegarder le monde et toutes ses données de joueurs et de progression dans Crafty.
3. Ouvrir un terminal Linux dans le conteneur Crafty, puis aller dans le dossier du serveur qui contient `olycity-update.sh`, `mods/` et `server.properties`. Utiliser le terminal Linux, pas la console Minecraft.
4. Vérifier que `java -version` indique **Java 17**, puis exécuter :

```sh
sh olycity-update.sh 1.0.9 --serveur-arrete
```

5. Attendre **Serveur mis a jour vers 1.0.9**. Si la commande échoue, garder le serveur arrêté et transmettre sa sortie.
6. Redémarrer avec la commande habituelle dans Crafty. Attendre **Done** dans les logs. `cat olycity-server-version.txt` doit afficher `1.0.9`.
7. Les joueurs ferment Minecraft et relancent la même instance Prism OLYCITY, avec la commande Packwiz autorisée.

Le Java sélectionné dans Crafty et celui du terminal doivent tous deux être Java 17. Si nécessaire, Romain adapte le PATH du terminal au runtime Java 17 de son conteneur.

La mise à jour conserve le monde, les joueurs, la progression des quêtes, `ops.json` et `server.properties`. Les nouveaux biomes et structures apparaissent dans les zones non explorées. Pour revenir en arrière après avoir joué sur cette version, restaurer la sauvegarde complète faite avant la mise à jour.

Ce hotfix retire Rats. Les objets, blocs et créatures de ce mod ne seront plus disponibles. La sauvegarde avant mise à jour permet un retour en arrière.
