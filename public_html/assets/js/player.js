/*
 * player.js — a remote or local player's 3D representation: a THREE.Group
 * built from torso + head + two arms + two legs (simple primitives sharing
 * one material). The torso is a unit SphereGeometry non-uniformly scaled
 * into a rounded capsule/mannequin-like shape (rather than a blocky box) to
 * read more like the plain white mannequin bodies of the reference game —
 * Three.js r128 (this project's CDN version, see game.html) predates
 * CapsuleGeometry (added r142), so a scaled sphere is the simplest smooth
 * stand-in that still keeps a single, well-defined UV layout for the painted
 * texture. Arms/legs are plain CylinderGeometry limbs (also r128-safe).
 *
 * For Hiders, that material's map is a THREE.Texture built straight from
 * the small painted PNG synced via api/game.php (see paint.js/room.js) —
 * so the exact same brush work the player did in the 2D toolbar gets
 * wrapped over their 3D body (torso/head/limbs all share the one material,
 * so the paint job reads consistently across the whole mannequin). Seekers
 * get a flat, clearly-visible color instead (never camouflaged).
 *
 * Coordinate note: player.x/y map directly onto Three.js world X/Z (see
 * scene3d.js header) — no extra transform needed here.
 */
(function (global) {
  'use strict';

  var BODY_W = 40, BODY_H = 90, BODY_D = 24, HEAD_R = 16;
  var LEG_LEN = 38, LEG_R = 7, LEG_GAP = 9;
  var TORSO_H = BODY_H - LEG_LEN;
  var ARM_LEN = 42, ARM_R = 6, ARM_GAP = BODY_W / 2 + ARM_R + 1;
  var SEEKER_COLOR = 0x2b6fe0;
  // Base torso scale that turns the unit sphere into the BODY_W x TORSO_H x
  // BODY_D ellipsoid — pose transforms (see _applyPose) multiply on top of
  // this rather than assuming scale 1 = full size.
  var BASE_SCALE = { x: BODY_W / 2, y: TORSO_H / 2, z: BODY_D / 2 };

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
    var legGeo = new THREE.CylinderGeometry(LEG_R, LEG_R * 0.85, LEG_LEN, 10);
    var armGeo = new THREE.CylinderGeometry(ARM_R, ARM_R * 0.85, ARM_LEN, 10);
    this.leftLegMesh = new THREE.Mesh(legGeo, this.material);
    this.rightLegMesh = new THREE.Mesh(legGeo, this.material);
    this.leftArmMesh = new THREE.Mesh(armGeo, this.material);
    this.rightArmMesh = new THREE.Mesh(armGeo, this.material);

    this.limbMeshes = [this.bodyMesh, this.headMesh, this.leftLegMesh, this.rightLegMesh, this.leftArmMesh, this.rightArmMesh];
    var self = this;
    this.limbMeshes.forEach(function (m) { m.userData.playerId = id; });
    this.group.add.apply(this.group, this.limbMeshes);

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

    this.group.position.set(this.x, this._groupY || 0, this.y);
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
  // skeletal animation) — each pose repositions torso/head/arms/legs to a
  // distinct silhouette matching the pose wheel in game.html. Scale factors
  // multiply BASE_SCALE (the unit-sphere -> full-size conversion), they
  // aren't absolute sizes themselves.
  Player.prototype._applyPose = function (pose) {
    this.group.rotation.set(0, 0, 0);
    var b = this.bodyMesh, h = this.headMesh;
    var ll = this.leftLegMesh, rl = this.rightLegMesh;
    var la = this.leftArmMesh, ra = this.rightArmMesh;
    ll.rotation.set(0, 0, 0); rl.rotation.set(0, 0, 0);
    la.rotation.set(0, 0, 0); ra.rotation.set(0, 0, 0);

    if (pose === 'crouch') {
      // Short, wide torso, bent legs, arms resting forward on the knees.
      var legH = LEG_LEN * 0.45;
      b.scale.set(BASE_SCALE.x * 1.1, BASE_SCALE.y * 0.55, BASE_SCALE.z * 1.1);
      b.position.y = legH + (TORSO_H * 0.55) / 2;
      h.position.y = b.position.y + (TORSO_H * 0.55) / 2 + HEAD_R * 0.7;
      positionLeg(ll, -LEG_GAP, legH, legH / LEG_LEN);
      positionLeg(rl, LEG_GAP, legH, legH / LEG_LEN);
      la.rotation.z = 0.55; ra.rotation.z = -0.55;
      positionArm(la, -ARM_GAP, b.position.y + 6, -0.3);
      positionArm(ra, ARM_GAP, b.position.y + 6, -0.3);
    } else if (pose === 'lean') {
      b.scale.set(BASE_SCALE.x, BASE_SCALE.y, BASE_SCALE.z);
      b.position.y = LEG_LEN + TORSO_H / 2;
      h.position.y = LEG_LEN + TORSO_H + HEAD_R * 0.8;
      this.group.rotation.z = -0.35;
      positionLeg(ll, -LEG_GAP, LEG_LEN, 1);
      positionLeg(rl, LEG_GAP, LEG_LEN, 1);
      positionArm(la, -ARM_GAP, b.position.y, 0.1);
      positionArm(ra, ARM_GAP, b.position.y, 0.1);
    } else if (pose === 'surrender') {
      // Standing tall, both arms raised straight up.
      b.scale.set(BASE_SCALE.x, BASE_SCALE.y, BASE_SCALE.z);
      b.position.y = LEG_LEN + TORSO_H / 2;
      h.position.y = LEG_LEN + TORSO_H + HEAD_R * 0.8;
      positionLeg(ll, -LEG_GAP, LEG_LEN, 1);
      positionLeg(rl, LEG_GAP, LEG_LEN, 1);
      la.rotation.z = Math.PI * 0.95; ra.rotation.z = -Math.PI * 0.95;
      positionArm(la, -ARM_GAP * 0.6, b.position.y + TORSO_H * 0.7, 0);
      positionArm(ra, ARM_GAP * 0.6, b.position.y + TORSO_H * 0.7, 0);
    } else if (pose === 'sit') {
      // Kneeling/seated — lower than stand, higher than crouch, arms at rest.
      var sitLeg = LEG_LEN * 0.3;
      b.scale.set(BASE_SCALE.x * 0.95, BASE_SCALE.y * 0.85, BASE_SCALE.z * 0.95);
      b.position.y = sitLeg + (TORSO_H * 0.85) / 2;
      h.position.y = b.position.y + (TORSO_H * 0.85) / 2 + HEAD_R * 0.75;
      positionLeg(ll, -LEG_GAP, sitLeg, sitLeg / LEG_LEN);
      positionLeg(rl, LEG_GAP, sitLeg, sitLeg / LEG_LEN);
      positionArm(la, -ARM_GAP, b.position.y + 4, -0.15);
      positionArm(ra, ARM_GAP, b.position.y + 4, -0.15);
    } else if (pose === 'prone') {
      // Lying flat on the ground — whole group tipped onto its front.
      b.scale.set(BASE_SCALE.x, BASE_SCALE.y, BASE_SCALE.z);
      b.position.y = LEG_LEN + TORSO_H / 2;
      h.position.y = LEG_LEN + TORSO_H + HEAD_R * 0.8;
      positionLeg(ll, -LEG_GAP, LEG_LEN, 1);
      positionLeg(rl, LEG_GAP, LEG_LEN, 1);
      positionArm(la, -ARM_GAP, b.position.y, 0.05);
      positionArm(ra, ARM_GAP, b.position.y, 0.05);
      this.group.rotation.x = -Math.PI / 2;
      this._groupY = LEG_R; // keep the tipped-over body just above the floor
    } else {
      // 'stand' (default)
      b.scale.set(BASE_SCALE.x, BASE_SCALE.y, BASE_SCALE.z);
      b.position.y = LEG_LEN + TORSO_H / 2;
      h.position.y = LEG_LEN + TORSO_H + HEAD_R * 0.8;
      positionLeg(ll, -LEG_GAP, LEG_LEN, 1);
      positionLeg(rl, LEG_GAP, LEG_LEN, 1);
      positionArm(la, -ARM_GAP, b.position.y, 0.08);
      positionArm(ra, ARM_GAP, b.position.y, 0.08);
    }

    this._groupY = (pose === 'prone') ? this._groupY : 0;
  };

  // Places a leg cylinder standing upright, scaled to `lenRatio` of its full
  // LEG_LEN so its foot always stays glued to the ground (y=0) whatever the
  // squash amount, and centered `xOff` to either side of the body midline.
  function positionLeg(mesh, xOff, standHeight, lenRatio) {
    mesh.scale.set(1, Math.max(0.05, lenRatio), 1);
    mesh.position.set(xOff, standHeight / 2, 0);
  }

  // Places an arm cylinder hanging from shoulder height `shoulderY`, offset
  // `xOff` to the side, tilted forward/back by `tiltX` radians (applied
  // before the pose-specific rotation.z already set by the caller).
  function positionArm(mesh, xOff, shoulderY, tiltX) {
    mesh.position.set(xOff, shoulderY - ARM_LEN * 0.35, 0);
    mesh.rotation.x = tiltX;
  }

  Player.prototype.dispose = function (scene) {
    scene.remove(this.group);
    this.bodyMesh.geometry.dispose();
    this.headMesh.geometry.dispose();
    this.leftLegMesh.geometry.dispose();
    this.leftArmMesh.geometry.dispose();
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
