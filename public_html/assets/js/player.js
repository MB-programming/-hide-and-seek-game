/*
 * player.js — a remote or local player's 3D representation: a THREE.Group
 * (box "torso" + sphere "head") that shares one material. For Hiders, that
 * material's map is a THREE.Texture built straight from the small painted
 * PNG synced via api/game.php (see paint.js/room.js) — so the exact same
 * brush work the player did in the 2D toolbar gets wrapped over their 3D
 * body. Seekers get a flat, clearly-visible color instead (never
 * camouflaged).
 *
 * Coordinate note: player.x/y map directly onto Three.js world X/Z (see
 * scene3d.js header) — no extra transform needed here.
 */
(function (global) {
  'use strict';

  var BODY_W = 40, BODY_H = 90, BODY_D = 24, HEAD_R = 16;
  var SEEKER_COLOR = 0x2b6fe0;

  function Player(id, data) {
    this.id = id;
    this._pose = null;
    this._role = null;
    this._paintRev = null;
    this._textureLoader = new THREE.TextureLoader();

    this.group = new THREE.Group();
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    this.bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D), this.material);
    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 14, 10), this.material);
    this.bodyMesh.userData.playerId = id;
    this.headMesh.userData.playerId = id;
    this.group.add(this.bodyMesh, this.headMesh);

    this.update(data);
  }

  Player.prototype.update = function (data) {
    if (!data) return;
    this.nickname = data.nickname || '?';
    this.x = typeof data.x === 'number' ? data.x : (this.x || 0);
    this.y = typeof data.y === 'number' ? data.y : (this.y || 0);
    this.alive = data.alive !== false;
    this.ready = !!data.ready;

    var role = data.role || 'hider';
    if (role !== this._role) {
      this._role = role;
      this._applyRoleAppearance(role);
    }
    this.role = role;

    var pose = data.pose || 'stand';
    if (pose !== this._pose) {
      this._pose = pose;
      this._applyPose(pose);
    }

    if (role !== 'seeker') {
      var rev = data.paint && data.paint.rev;
      if (rev !== undefined && rev !== this._paintRev && data.paint.data) {
        this._paintRev = rev;
        this._loadPaintTexture(data.paint.data);
      }
    }

    this.material.transparent = !this.alive;
    this.material.opacity = this.alive ? 1 : 0.35;

    this.group.position.set(this.x, 0, this.y);
  };

  Player.prototype._applyRoleAppearance = function (role) {
    if (role === 'seeker') {
      this.material.map = null;
      this.material.color.setHex(SEEKER_COLOR);
    } else {
      this.material.color.setHex(0xffffff);
      // Leave any existing painted map in place if one was already loaded
      // (e.g. rejoining mid-round); otherwise the blank white body from
      // paint.js's default silhouette fill shows through once it arrives.
    }
    this.material.needsUpdate = true;
  };

  Player.prototype._loadPaintTexture = function (dataUrl) {
    var material = this.material;
    this._textureLoader.load(dataUrl, function (tex) {
      tex.needsUpdate = true;
      material.map = tex;
      material.needsUpdate = true;
    });
  };

  // Poses reshape the 3D body via simple scale/rotation transforms (no
  // skeletal animation) — crouch squashes+widens the torso, lean tilts the
  // whole group about its base, matching the pose buttons in game.html.
  Player.prototype._applyPose = function (pose) {
    this.group.rotation.set(0, 0, 0);
    this.bodyMesh.scale.set(1, 1, 1);

    if (pose === 'crouch') {
      this.bodyMesh.scale.set(1.15, 0.5, 1.15);
      var h = BODY_H * 0.5;
      this.bodyMesh.position.y = h / 2;
      this.headMesh.position.y = h + HEAD_R * 0.7;
    } else if (pose === 'lean') {
      this.group.rotation.z = -0.35;
      this.bodyMesh.position.y = BODY_H / 2;
      this.headMesh.position.y = BODY_H + HEAD_R * 0.8;
    } else {
      this.bodyMesh.position.y = BODY_H / 2;
      this.headMesh.position.y = BODY_H + HEAD_R * 0.8;
    }
  };

  Player.prototype.dispose = function (scene) {
    scene.remove(this.group);
    this.bodyMesh.geometry.dispose();
    this.headMesh.geometry.dispose();
    if (this.material.map) this.material.map.dispose();
    this.material.dispose();
  };

  global.ZizoPlayer = {
    Player: Player,
    BODY_W: BODY_W,
    BODY_H: BODY_H,
    BODY_D: BODY_D,
    HEAD_R: HEAD_R
  };
})(window);
