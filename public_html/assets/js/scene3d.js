/*
 * scene3d.js — builds the actual 3D room (Three.js) for a stage: floor,
 * three walls (front is left open so the camera can see in, like a stage
 * set), and camouflage "zone" props as simple colored boxes with real
 * lighting/shading — replacing the old flat 2D procedural background.
 *
 * Coordinate system: world X/Z map 1:1 onto the stage's existing x/y
 * numbers (data/stages/*.json, Firebase player.x/y) with NO extra offset —
 * a player at Firebase {x:80, y:470} sits at Three.js position (80, footY,
 * 470). This is deliberate: it means room.js, input.js and every existing
 * x/y number in stage configs needed ZERO changes for the 3D rewrite, only
 * new fields (wallHeight/floorColor/wallColor/zone.height/zone.color) were
 * added on top.
 *
 * Every surface (floor/walls/zone box) gets a flat base color plus a subtle
 * procedurally-generated checker texture for visual richness by default —
 * no external art assets required to make every stage playable out of the
 * box. An admin can optionally upload a real floor photo/texture from
 * stages.php, which replaces the procedural floor pattern (see the
 * stage.backgroundImage branch below); walls and zone props always use the
 * procedural/flat-color treatment. Either way, each mesh's base color is
 * stored in `mesh.userData.color` so the eyedropper tool (game-main.js) can
 * read "the exact color of whatever the player is standing in front of" via
 * a raycast hit against pickableMeshes.
 */
(function (global) {
  'use strict';

  function clampByte(v) { return Math.max(0, Math.min(255, v)); }

  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#888888');
    if (!m) return { r: 136, g: 136, b: 136 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  function shade(hex, percent) {
    var c = hexToRgb(hex);
    var amt = Math.round(2.55 * percent);
    var r = clampByte(c.r + amt), g = clampByte(c.g + amt), b = clampByte(c.b + amt);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // A soft 4x4 checker pattern in two shades of the same base color — cheap
  // way to make flat surfaces read as real textured materials instead of
  // solid "colored paper" rectangles, with zero image assets.
  function makeCheckerTexture(baseColor) {
    var size = 128;
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = shade(baseColor, 6);
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = shade(baseColor, -6);
    var n = 4, cell = size / n;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        if ((i + j) % 2 === 0) ctx.fillRect(i * cell, j * cell, cell, cell);
      }
    }
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function buildScene(stage) {
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(shade(stage.wallColor || '#666666', -35));

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    scene.add(new THREE.HemisphereLight(0xddeeff, 0x554433, 0.35));

    var wallHeight = stage.wallHeight || 220;
    var sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(stage.width * 0.3, wallHeight * 3, stage.height * 0.15);
    // Aim at the room's center rather than THREE's default (0,0,0) world
    // origin/room corner, so shading falls evenly across the whole floor.
    sun.target.position.set(stage.width / 2, 0, stage.height / 2);
    scene.add(sun);
    scene.add(sun.target);

    // --- floor ---
    // If the admin uploaded a real floor photo/texture (stages.php), use it
    // in place of the procedural checker pattern for a more realistic look.
    var floorMat;
    if (stage.backgroundImage) {
      var uploadedTex = new THREE.TextureLoader().load(stage.backgroundImage);
      uploadedTex.wrapS = uploadedTex.wrapT = THREE.RepeatWrapping;
      uploadedTex.repeat.set(Math.max(2, Math.round(stage.width / 300)), Math.max(2, Math.round(stage.height / 300)));
      floorMat = new THREE.MeshStandardMaterial({ map: uploadedTex, roughness: 0.9 });
    } else {
      var floorTex = makeCheckerTexture(stage.floorColor || '#888888');
      floorTex.repeat.set(Math.max(3, Math.round(stage.width / 150)), Math.max(2, Math.round(stage.height / 150)));
      floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 });
    }
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(stage.width, stage.height), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(stage.width / 2, 0, stage.height / 2);
    floor.userData = { color: stage.floorColor || '#888888', label: 'Floor' };
    scene.add(floor);

    // --- walls (back + left + right; front stays open toward the camera) ---
    var wallTex = makeCheckerTexture(stage.wallColor || '#999999');
    wallTex.repeat.set(Math.max(2, Math.round(stage.width / 220)), Math.max(1, Math.round(wallHeight / 150)));
    var wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1 });
    var walls = [];

    function addWall(w, h, x, y, z, rotY) {
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
      mesh.position.set(x, y, z);
      mesh.rotation.y = rotY || 0;
      mesh.userData = { color: stage.wallColor || '#999999', label: 'Wall' };
      scene.add(mesh);
      walls.push(mesh);
    }
    addWall(stage.width, wallHeight, stage.width / 2, wallHeight / 2, 0, 0);
    addWall(stage.height, wallHeight, 0, wallHeight / 2, stage.height / 2, Math.PI / 2);
    addWall(stage.height, wallHeight, stage.width, wallHeight / 2, stage.height / 2, -Math.PI / 2);

    // --- zone props (camouflage objects) ---
    var zoneMeshes = [];
    (stage.zones || []).forEach(function (z) {
      var h = z.height || 80;
      var mesh = new THREE.Mesh(
        new THREE.BoxGeometry(z.w, h, z.h),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(z.color || '#888888'), roughness: 0.85 })
      );
      mesh.position.set(z.x + z.w / 2, h / 2, z.y + z.h / 2);
      mesh.userData = { color: z.color || '#888888', label: z.label || 'Object' };
      scene.add(mesh);
      zoneMeshes.push(mesh);
    });

    return {
      scene: scene,
      floor: floor,
      walls: walls,
      zoneMeshes: zoneMeshes,
      pickableMeshes: [floor].concat(walls, zoneMeshes)
    };
  }

  global.ZizoScene3D = { buildScene: buildScene };
})(window);
