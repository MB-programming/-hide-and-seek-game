/*
 * player.js — a remote or local player's 3D representation: a THREE.Group
 * (smooth ellipsoid "torso" + sphere "head") that shares one material. The
 * torso is a unit SphereGeometry non-uniformly scaled into a rounded
 * capsule/mannequin-like shape (rather than a blocky box) to read more like
 * the plain white mannequin bodies of the reference game — Three.js r128
 * (this project's CDN version, see game.html) predates CapsuleGeometry
 * (added r142), so a scaled sphere is the simplest smooth stand-in that
 * still keeps a single, well-defined UV layout for the painted texture.
 *
 * For Hiders, that material's map is a THREE.Texture built straight from
 * the small painted PNG synced via api/game.php (see paint.js/room.js) —
 * so the exact same brush work the player did in the 2D toolbar gets
 * wrapped over their 3D body. Seekers get a flat, clearly-visible color
 * instead (never camouflaged).
 *
 * Coordinate note: player.x/y map directly onto Three.js world X/Z (see
 * scene3d.js header) — no extra transform needed here.
 */
(function (global) {
  'use strict';

  var BODY_W = 40, BODY_H = 90, BODY_D = 24, HEAD_R = 16;
  var SEEKER_COLOR = 0x2b6fe0;
  // Base torso scale that turns the unit sphere into the BODY_W x BODY_H x
  // BODY_D ellipsoid — pose transforms (see _applyPose) multiply on top of
  // this rather than assuming scale 1 = full size.
  var BASE_SCALE = { x: BODY_W / 2, y: BODY_H / 2, z: BODY_D / 2 };

  function Player(id, data) {
    this.id = id;
    this._pose = null;
    this._role = null;
    this._paintRev = null;
    this._textureLoader = new THREE.TextureLoader();

    this.group = new THREE.Group();
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    this.bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), this.material);
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
  // Scale factors here multiply BASE_SCALE (the unit-sphere -> full-size
  // conversion), they aren't absolute sizes themselves.
  Player.prototype._applyPose = function (pose) {
    this.group.rotation.set(0, 0, 0);

    if (pose === 'crouch') {
      this.bodyMesh.scale.set(BASE_SCALE.x * 1.15, BASE_SCALE.y * 0.5, BASE_SCALE.z * 1.15);
      var h = BODY_H * 0.5;
      this.bodyMesh.position.y = h / 2;
      this.headMesh.position.y = h + HEAD_R * 0.7;
    } else if (pose === 'lean') {
      this.bodyMesh.scale.set(BASE_SCALE.x, BASE_SCALE.y, BASE_SCALE.z);
      this.group.rotation.z = -0.35;
      this.bodyMesh.position.y = BODY_H / 2;
      this.headMesh.position.y = BODY_H + HEAD_R * 0.8;
    } else {
      this.bodyMesh.scale.set(BASE_SCALE.x, BASE_SCALE.y, BASE_SCALE.z);
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
