const labels = {
  adventure:'Aventure', horror:'Horreur', survival:'Survie', puzzle:'Réflexion',
  simulator:'Simulation', simulation:'Simulation', strategy:'Stratégie', racing:'Course',
  shooter:'Tir', platform:'Plateforme', sport:'Sport', indie:'Indépendant',
  'role-playing (rpg)':'Jeu de rôle', 'role-playing':'Jeu de rôle', rpg:'Jeu de rôle',
  'hack and slash/beat em up':'Action', "hack and slash/beat 'em up":'Action', 'tactical':'Tactique', 'fighting':'Combat',
  'music':'Musique', 'arcade':'Arcade', 'co-operative':'Coop',
};
export const visibleGenre = tag => String(tag).trim().toLowerCase() !== 'steam';
export const genreLabel = tag => labels[String(tag).trim().toLowerCase()] || String(tag);
