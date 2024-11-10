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
    this.paddleWidth = 0;
    this.paddleHeight = 0.02;
    this.paddleDepth = 0.05;
    this.ball = null;
    this.ballVelocity = new THREE.Vector3(0.02, 0, 0.02); // Initial ball velocity
    this.fieldWidth = 0;
    this.fieldHeight = 0;
    this.fieldGroup = null;
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
      while (this.scene.children.length > 0) {
        this.scene.remove(this.scene.children[0]);
      }
      this.fieldCreated = false;
      shouldUpdateGridPosition = true;
    }

    const position = this.reticle.position.clone();
    this.tapPositions.push(position);

    if (this.tapPositions.length === 1) {
      // Capture the field's orientation from the reticle
      this.fieldOrientation.copy(this.reticle.quaternion);
      shouldUpdateGridPosition = false;
    }

    if (this.tapPositions.length === 2) {
      this.createField();
    }
  };

  createField = () => {
    // Ensure there are two tapped positions
    if (this.tapPositions.length < 2) {
      console.error('Not enough tap positions to create the field.');
      return;
    }

    // Define pos1 and pos3 from tap positions
    const pos1 = this.tapPositions[0]; // First corner
    const pos3 = this.tapPositions[1]; // Opposite corner

    console.log('Creating field with corners:', pos1, pos3);

    // Compute the other two corners (pos2 and pos4)
    const pos2 = new THREE.Vector3(pos3.x, pos1.y, pos1.z);
    const pos4 = new THREE.Vector3(pos1.x, pos3.y, pos3.z);

    // Compute center position
    const centerX = (pos1.x + pos3.x) / 2;
    const centerY = (pos1.y + pos3.y) / 2;
    const centerZ = (pos1.z + pos3.z) / 2;

    // Compute field dimensions
    this.fieldWidth = Math.abs(pos3.x - pos1.x);
    this.fieldHeight = Math.abs(pos3.z - pos1.z);

    // Create a group to hold the field components
    this.fieldGroup = new THREE.Group();
    this.fieldGroup.position.set(centerX, centerY, centerZ);
    this.fieldGroup.quaternion.copy(this.fieldOrientation);

    // Array of vertices to form the rectangle
    const vertices = [pos1, pos2, pos3, pos4, pos1]; // Closing the loop

    // Create geometry from the vertices
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);

    // Create a line material
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 10,
    });

    // Create a LineLoop to connect the vertices
    const lineLoop = new THREE.LineLoop(geometry, material);
    lineLoop.position.set(0, 0.01, 0);

    this.fieldGroup.add(lineLoop);

    // Create Paddles
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
      0,
      this.paddleHeight / 2,
      -this.fieldHeight / 2 + this.paddleDepth
    );
    this.fieldGroup.add(this.playerPaddle);

    // Enemy Paddle
    this.enemyPaddle = new THREE.Mesh(paddleGeometry, paddleMaterial);
    this.enemyPaddle.position.set(
      0,
      this.paddleHeight / 2,
      this.fieldHeight / 2 - this.paddleDepth
    );
    this.fieldGroup.add(this.enemyPaddle);

    // Create Ball
    const ballRadius = 0.03;
    const ballGeometry = new THREE.SphereGeometry(ballRadius, 16, 16);
    const ballMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.ball = new THREE.Mesh(ballGeometry, ballMaterial);
    this.ball.position.set(0, ballRadius, 0);
    this.fieldGroup.add(this.ball);

    // Add the field group to the scene
    this.scene.add(this.fieldGroup);

    // Set fieldCreated to true
    this.fieldCreated = true;

    // Clear tap positions
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

      // Clear the renderer before rendering the new frame
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
          this.planeFloor.visible = true;
          if (shouldUpdateGridPosition) {
            this.planeFloor.position.copy(this.reticle.position);
            // Rotate the grid to lay horizontally
            this.planeFloor.rotation.x = Math.PI / 2;
          }
          this.planeFloor.updateMatrixWorld(true);

          this.grid.visible = true;
          if (shouldUpdateGridPosition) {
            this.grid.position.copy(this.reticle.position);
          }
          this.grid.updateMatrixWorld(true);
        } else {
          this.planeFloor.visible = false;
          this.grid.visible = false;

          this.updateGame();
        }
      }

      this.renderer.render(this.scene, this.camera);
    }
  };

  setupThreeJs() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      // Remove 'preserveDrawingBuffer: true' to allow clearing between frames
      canvas: this.canvas,
      context: this.gl,
    });
    this.renderer.autoClear = true; // Enable auto clearing of the canvas
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = Utils.createLitScene();
    this.reticle = new Reticle();
    this.scene.add(this.reticle);

    // Create the plane floor to display until the field is created
    this.planeFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
      new THREE.MeshBasicMaterial({
        color: 0x72d1e2, // Blue color for the grid lines
        side: THREE.DoubleSide, // Make sure both sides are visible
        transparent: true,
        opacity: 0.2,
      })
    );
    // No need to rotate the plane floor here; we'll align it with the reticle
    this.planeFloor.visible = false;
    this.scene.add(this.planeFloor);

    this.grid = new THREE.GridHelper(
      GRID_SIZE,
      GRID_SIZE * 3,
      0x72d1e2,
      0x107ab2
    ); // 10 units, 10 divisions
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

    // **Collision Detection with Side Walls**
    if (
      this.ball.position.x <= -halfFieldWidth + 0.05 ||
      this.ball.position.x >= halfFieldWidth - 0.05
    ) {
      this.ballVelocity.x *= -1; // Reverse X direction
    }

    // **Collision Detection with Player Paddle**
    if (
      this.ball.position.z <= -halfFieldHeight + this.paddleDepth &&
      Math.abs(this.ball.position.x - this.playerPaddle.position.x) <=
        this.paddleWidth / 2
    ) {
      this.ballVelocity.z *= -1; // Reverse Z direction
    }

    // **Collision Detection with Enemy Paddle**
    if (
      this.ball.position.z >= halfFieldHeight - this.paddleDepth &&
      Math.abs(this.ball.position.x - this.enemyPaddle.position.x) <=
        this.paddleWidth / 2
    ) {
      this.ballVelocity.z *= -1; // Reverse Z direction
    }

    // **Collision with Top and Bottom (Score)**
    if (
      this.ball.position.z <= -halfFieldHeight ||
      this.ball.position.z >= halfFieldHeight
    ) {
      // Reset ball position
      this.ball.position.set(0, this.ball.position.y, 0);
      // Optionally reset ball velocity or update score
    }

    // **Enemy Paddle AI**
    this.enemyPaddle.position.x = THREE.MathUtils.lerp(
      this.enemyPaddle.position.x,
      this.ball.position.x,
      0.05
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

    // Map NDC to field coordinates
    const fieldX = ndcX * (this.fieldWidth / 2);

    // Clamp paddle position within field boundaries
    const halfFieldWidth = this.fieldWidth / 2;
    const maxPaddleX = halfFieldWidth - this.paddleWidth / 2;

    this.playerPaddle.position.x = THREE.MathUtils.clamp(
      fieldX,
      -maxPaddleX,
      maxPaddleX
    );
  };
}

window.app = new App();
