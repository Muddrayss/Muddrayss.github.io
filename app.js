const GRID_SIZE = 500;

let shouldUpdateGridPosition = true;

(async function () {
  const isArSessionSupported =
    navigator.xr &&
    navigator.xr.isSessionSupported &&
    (await navigator.xr.isSessionSupported('immersive-ar'));
  if (isArSessionSupported) {
    document
      .getElementById('enter-ar')
      .addEventListener('click', window.app.activateXR);
  } else {
    onNoXRDevice();
  }
})();

class App {
  constructor() {
    this.tapPositions = [];
    this.fieldCreated = false;
    this.fieldOrientation = new THREE.Quaternion();
    this.playerPaddle = null;
    this.enemyPaddle = null;
    this.enemyPaddleSpeed = 7;
    this.paddleWidth = 0;
    this.paddleHeight = 0.02;
    this.paddleDepth = 0.05;
    this.ball = null;
    this.ballVelocity = new THREE.Vector3(0.02, 0, 0.02);
    this.fieldWidth = 0;
    this.fieldHeight = 0;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.reticle = null;
    this.grid = null;
    this.xrSession = null;
    this.gl = null;
    this.localReferenceSpace = null;
    this.viewerSpace = null;
    this.hitTestSource = null;
    this.stabilized = false;
    this.centerX = 0;
    this.centerY = 0;
    this.centerZ = 0;
    this.ballRadius = 0.03;
    this.ghostField = null;
  }

  activateXR = async () => {
    try {
      this.xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: document.body },
      });

      this.createXRCanvas();

      await this.onSessionStarted();

      this.canvas.addEventListener('touchstart', this.onTouchStart);
      this.canvas.addEventListener('touchmove', this.onTouchMove);
    } catch (e) {
      console.log(e);
      onNoXRDevice();
    }
  };

  createXRCanvas() {
    this.canvas = document.createElement('canvas');
    document.body.appendChild(this.canvas);
    this.gl = this.canvas.getContext('webgl', { xrCompatible: true });

    this.xrSession.updateRenderState({
      baseLayer: new XRWebGLLayer(this.xrSession, this.gl),
    });
  }

  onSessionStarted = async () => {
    document.body.classList.add('ar');

    this.setupThreeJs();

    this.localReferenceSpace = await this.xrSession.requestReferenceSpace(
      'local'
    );

    this.viewerSpace = await this.xrSession.requestReferenceSpace('viewer');

    this.hitTestSource = await this.xrSession.requestHitTestSource({
      space: this.viewerSpace,
    });

    this.xrSession.requestAnimationFrame(this.onXRFrame);

    this.xrSession.addEventListener('select', this.onSelect);
  };

  onSelect = () => {
    if (this.fieldCreated) {
      return;
      // this.scene.remove(this.playerPaddle);
      // this.scene.remove(this.enemyPaddle);
      // this.scene.remove(this.ball);
      // this.scene.remove(this.lineLoop);
      // this.fieldCreated = false;
      // shouldUpdateGridPosition = true;
    }

    const position = this.reticle.position.clone();
    this.tapPositions.push(position);

    if (this.tapPositions.length === 1) {
      this.fieldOrientation.copy(this.reticle.quaternion);
      shouldUpdateGridPosition = false;

      // Create ghost field
      if (!this.ghostField) {
        const material = new THREE.LineBasicMaterial({
          color: 0xaaaaaa,
          linewidth: 10,
          transparent: true,
          opacity: 0.5,
        });
        const geometry = new THREE.BufferGeometry();
        this.ghostField = new THREE.LineLoop(geometry, material);
        this.scene.add(this.ghostField);
      }
    }

    if (this.tapPositions.length === 2) {
      this.createField();
    }
  };

  createField = () => {
    if (this.tapPositions.length < 2) {
      console.error('Not enough tap positions to create the field.');
      return;
    }

    const pos1 = this.tapPositions[0];
    const pos3 = this.tapPositions[1];

    // Compute other corners
    const pos2 = new THREE.Vector3(pos3.x, pos1.y, pos1.z);
    const pos4 = new THREE.Vector3(pos1.x, pos3.y, pos3.z);

    // Compute center position
    const centerX = (pos1.x + pos3.x) / 2;
    const centerY = (pos1.y + pos3.y) / 2;
    const centerZ = (pos1.z + pos3.z) / 2;

    // Save center positions
    this.centerX = centerX;
    this.centerY = centerY;
    this.centerZ = centerZ;

    // Compute field dimensions
    this.fieldWidth = Math.abs(pos3.x - pos1.x);
    this.fieldHeight = Math.abs(pos3.z - pos1.z);

    // Create field lines
    const vertices = [pos1, pos2, pos3, pos4, pos1];
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 10,
    });

    this.lineLoop = new THREE.LineLoop(geometry, material);
    this.scene.add(this.lineLoop);

    // Set paddle dimensions
    this.paddleWidth = this.fieldWidth * 0.2;

    const paddleGeometry = new THREE.BoxGeometry(
      this.paddleWidth,
      this.paddleHeight,
      this.paddleDepth
    );
    const paddleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

    // Player Paddle
    this.playerPaddle = new THREE.Mesh(paddleGeometry, paddleMaterial);
    this.playerPaddle.position.set(
      this.centerX,
      this.centerY + this.paddleHeight / 2,
      this.centerZ - this.fieldHeight / 2 + this.paddleDepth
    );
    this.scene.add(this.playerPaddle);

    // Enemy Paddle
    this.enemyPaddle = new THREE.Mesh(paddleGeometry, paddleMaterial);
    this.enemyPaddle.position.set(
      this.centerX,
      this.centerY + this.paddleHeight / 2,
      this.centerZ + this.fieldHeight / 2 - this.paddleDepth
    );
    this.scene.add(this.enemyPaddle);

    // Ball
    this.ballRadius = 0.03; // Save ball radius as a class property
    const ballGeometry = new THREE.SphereGeometry(this.ballRadius, 16, 16);
    const ballMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.ball = new THREE.Mesh(ballGeometry, ballMaterial);
    this.ball.position.set(
      this.centerX,
      this.centerY + this.ballRadius,
      this.centerZ
    );
    this.scene.add(this.ball);

    this.fieldCreated = true;
    this.tapPositions = [];
  };

  onXRFrame = (time, frame) => {
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    const framebuffer = this.xrSession.renderState.baseLayer.framebuffer;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.renderer.setFramebuffer(framebuffer);

    const pose = frame.getViewerPose(this.localReferenceSpace);
    if (pose) {
      const view = pose.views[0];

      const viewport = this.xrSession.renderState.baseLayer.getViewport(view);
      this.renderer.setSize(viewport.width, viewport.height);

      this.renderer.clear();

      this.camera.matrix.fromArray(view.transform.matrix);
      this.camera.projectionMatrix.fromArray(view.projectionMatrix);
      this.camera.updateMatrixWorld(true);

      const hitTestResults = frame.getHitTestResults(this.hitTestSource);

      if (!this.stabilized && hitTestResults.length > 0) {
        this.stabilized = true;
        document.body.classList.add('stabilized');
      }
      if (hitTestResults.length > 0) {
        const hitPose = hitTestResults[0].getPose(this.localReferenceSpace);

        this.reticle.visible = true;
        this.reticle.position.set(
          hitPose.transform.position.x,
          hitPose.transform.position.y,
          hitPose.transform.position.z
        );
        this.reticle.quaternion.set(
          hitPose.transform.orientation.x,
          hitPose.transform.orientation.y,
          hitPose.transform.orientation.z,
          hitPose.transform.orientation.w
        );
        this.reticle.updateMatrixWorld(true);
        if (!this.fieldCreated) {
          if (this.tapPositions.length === 1 && this.ghostField) {
            const pos1 = this.tapPositions[0];
            const pos3 = this.reticle.position.clone();

            // Compute other corners
            const pos2 = new THREE.Vector3(pos3.x, pos1.y, pos1.z);
            const pos4 = new THREE.Vector3(pos1.x, pos3.y, pos3.z);

            // Array of vertices to form the rectangle
            const vertices = [pos1, pos2, pos3, pos4, pos1];

            // Update ghost field geometry
            const positions = new Float32Array(vertices.length * 3);
            for (let i = 0; i < vertices.length; i++) {
              positions[i * 3] = vertices[i].x;
              positions[i * 3 + 1] = vertices[i].y;
              positions[i * 3 + 2] = vertices[i].z;
            }

            this.ghostField.geometry.setAttribute(
              'position',
              new THREE.BufferAttribute(positions, 3)
            );
            this.ghostField.geometry.attributes.position.needsUpdate = true;
          }

          this.grid.visible = true;
          if (shouldUpdateGridPosition) {
            this.grid.position.copy(this.reticle.position);
          }
          this.grid.updateMatrixWorld(true);
        } else {
          this.grid.visible = false;
          this.reticle.visible = false;
          this.ghostField.visible = false;
          // if (this.ghostField) {
          //   this.scene.remove(this.ghostField);
          //   this.ghostField.geometry.dispose();
          //   this.ghostField.material.dispose();
          //   this.ghostField = null;
          // }

          this.updateGame();
        }
      }

      this.renderer.render(this.scene, this.camera);
    }
  };

  setupThreeJs() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      canvas: this.canvas,
      context: this.gl,
    });
    this.renderer.autoClear = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = Utils.createLitScene();
    this.reticle = new Reticle();
    this.scene.add(this.reticle);

    this.grid = new THREE.GridHelper(
      GRID_SIZE,
      GRID_SIZE * 3,
      0x72d1e2,
      0x107ab2
    );
    this.grid.visible = false;
    this.scene.add(this.grid);

    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
  }

  updateGame = () => {
    if (!this.fieldCreated) return;

    // Update ball position
    this.ball.position.add(this.ballVelocity);

    const halfFieldWidth = this.fieldWidth / 2;
    const halfFieldHeight = this.fieldHeight / 2;

    // Collision with side walls
    if (
      this.ball.position.x >= this.centerX + halfFieldWidth - this.ballRadius ||
      this.ball.position.x <= this.centerX - halfFieldWidth + this.ballRadius
    ) {
      this.ballVelocity.x *= -1;
    }

    // Collision with player paddle
    if (
      this.ball.position.z <=
        this.centerZ - halfFieldHeight - this.paddleDepth &&
      Math.abs(this.ball.position.x - this.playerPaddle.position.x) <=
        this.paddleWidth / 2
    ) {
      this.ballVelocity.z *= -1;
    }

    // Collision with enemy paddle
    if (
      this.ball.position.z >=
        this.centerZ + halfFieldHeight + this.paddleDepth &&
      Math.abs(this.ball.position.x - this.enemyPaddle.position.x) <=
        this.paddleWidth / 2
    ) {
      this.ballVelocity.z *= -1;
    }

    // Ball goes out of bounds (score)
    if (
      this.ball.position.z <= this.centerZ - halfFieldHeight ||
      this.ball.position.z >= this.centerZ + halfFieldHeight
    ) {
      // Reset ball position
      this.ball.position.set(
        this.centerX,
        this.centerY + this.ballRadius,
        this.centerZ
      );
    }

    // Enemy paddle AI
    const deltaX = this.ball.position.x - this.enemyPaddle.position.x;
    const maxMovement = this.enemyPaddleSpeed;

    if (Math.abs(deltaX) > maxMovement) {
      this.enemyPaddle.position.x += Math.sign(deltaX) * maxMovement;
    } else {
      this.enemyPaddle.position.x = this.ball.position.x;
    }

    // Clamp enemy paddle within field boundaries
    const maxPaddleX = halfFieldWidth - this.paddleWidth / 2;
    this.enemyPaddle.position.x = THREE.MathUtils.clamp(
      this.enemyPaddle.position.x,
      this.centerX - maxPaddleX,
      this.centerX + maxPaddleX
    );
  };

  onTouchStart = (event) => {
    event.preventDefault();
  };

  onTouchMove = (event) => {
    event.preventDefault();

    if (!this.fieldCreated) return;

    const touch = event.touches[0];

    // Convert touch X position to normalized device coordinates (-1 to 1)
    const ndcX = (touch.clientX / window.innerWidth) * 2 - 1;

    const halfFieldWidth = this.fieldWidth / 2;

    // Map NDC to field coordinates relative to centerX
    const fieldX = ndcX * halfFieldWidth + this.centerX;

    const maxPaddleX = halfFieldWidth - this.paddleWidth / 2;
    this.playerPaddle.position.x = THREE.MathUtils.clamp(
      fieldX,
      this.centerX - maxPaddleX,
      this.centerX + maxPaddleX
    );
  };
}

window.app = new App();
