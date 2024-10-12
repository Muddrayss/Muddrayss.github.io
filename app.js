/**
 * AR Pong Game using WebXR and Three.js
 * Author: Your Name
 * Date: YYYY-MM-DD
 */

// Ensure the script runs after the DOM is fully loaded
window.addEventListener('DOMContentLoaded', () => {
  // Check for WebXR support
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
      if (supported) {
        document
          .getElementById('enter-ar')
          .addEventListener('click', activateXR);
      } else {
        onNoXRDevice();
      }
    });
  } else {
    onNoXRDevice();
  }
});

/**
 * Display unsupported message
 */
function onNoXRDevice() {
  document.getElementById('enter-ar-info').style.display = 'none';
  document.getElementById('unsupported-info').style.display = 'block';
}

/**
 * Activate the WebXR AR Session
 */
async function activateXR() {
  const enterARButton = document.getElementById('enter-ar-info');
  enterARButton.style.display = 'none';

  try {
    // Request an immersive AR session
    const xrSession = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
    });

    // Create a renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.autoClear = false;
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Create a Three.js scene
    const scene = new THREE.Scene();

    // Add a camera
    const camera = new THREE.PerspectiveCamera();
    scene.add(camera);

    // Create a local reference space
    const referenceSpace = await xrSession.requestReferenceSpace('local');

    // Set up hit testing
    const hitTestSource = await xrSession.requestHitTestSource({
      space: referenceSpace,
    });

    // Set the renderer's XR session
    renderer.xr.setSession(xrSession);

    // Add lighting
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    scene.add(light);

    // Game Variables
    const vertices = [];
    let field = null;
    let paddle1 = null;
    let paddle2 = null;
    let ball = null;
    let ballVelocity = new THREE.Vector3(0.02, 0, 0.02);
    let isGameActive = false;

    // Create a reticle for hit testing
    const reticleGeometry = new THREE.RingGeometry(0.02, 0.04, 32).rotateX(
      -Math.PI / 2
    );
    const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Handle session end
    xrSession.addEventListener('end', () => {
      renderer.dispose();
      document.body.removeChild(renderer.domElement);
      document.getElementById('enter-ar-info').style.display = 'block';
    });

    // Handle user input to place vertices
    xrSession.addEventListener('select', () => {
      if (reticle.visible && vertices.length < 4 && !isGameActive) {
        const position = new THREE.Vector3();
        position.setFromMatrixPosition(reticle.matrix);
        vertices.push(position.clone());

        // Visual feedback: place a small sphere at the vertex
        const sphereGeometry = new THREE.SphereGeometry(0.01, 16, 16);
        const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere.position.copy(position);
        scene.add(sphere);

        if (vertices.length === 4) {
          createPongField();
          isGameActive = true;
        }
      }
    });

    /**
     * Create the Pong field using the four vertices
     */
    function createPongField() {
      // Create geometry for the field as two triangles (a rectangle)
      const geometry = new THREE.BufferGeometry();

      const verticesArray = new Float32Array([
        vertices[0].x,
        vertices[0].y,
        vertices[0].z,
        vertices[1].x,
        vertices[1].y,
        vertices[1].z,
        vertices[2].x,
        vertices[2].y,
        vertices[2].z,

        vertices[2].x,
        vertices[2].y,
        vertices[2].z,
        vertices[3].x,
        vertices[3].y,
        vertices[3].z,
        vertices[0].x,
        vertices[0].y,
        vertices[0].z,
      ]);

      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(verticesArray, 3)
      );
      geometry.computeVertexNormals();

      const material = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
      });

      field = new THREE.Mesh(geometry, material);
      scene.add(field);

      // Create paddles
      createPaddles();

      // Create the ball
      createBall();
    }

    /**
     * Create two paddles on opposite sides of the field
     */
    function createPaddles() {
      // Calculate centers of two opposite sides
      const side1Center = new THREE.Vector3()
        .addVectors(vertices[0], vertices[1])
        .multiplyScalar(0.5);
      const side2Center = new THREE.Vector3()
        .addVectors(vertices[2], vertices[3])
        .multiplyScalar(0.5);

      // Calculate the direction of the field
      const fieldDirection = new THREE.Vector3()
        .subVectors(vertices[1], vertices[0])
        .normalize();

      // Create paddle geometry
      const paddleGeometry = new THREE.BoxGeometry(0.05, 0.005, 0.02);
      const paddleMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });

      // Paddle 1
      paddle1 = new THREE.Mesh(paddleGeometry, paddleMaterial);
      paddle1.position.copy(side1Center);
      paddle1.lookAt(vertices[1]); // Align paddle with the field
      scene.add(paddle1);

      // Paddle 2
      paddle2 = new THREE.Mesh(paddleGeometry, paddleMaterial);
      paddle2.position.copy(side2Center);
      paddle2.lookAt(vertices[3]); // Align paddle with the field
      scene.add(paddle2);

      // Enable paddle1 to be controlled by the user
      setupPaddleControls();
    }

    /**
     * Create the ball in the center of the field
     */
    function createBall() {
      const ballGeometry = new THREE.SphereGeometry(0.01, 16, 16);
      const ballMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      ball = new THREE.Mesh(ballGeometry, ballMaterial);

      // Position the ball at the center of the field
      const center = new THREE.Vector3()
        .addVectors(vertices[0], vertices[2])
        .multiplyScalar(0.5);
      ball.position.copy(center);

      scene.add(ball);
    }

    /**
     * Setup touch controls to move paddle1
     */
    function setupPaddleControls() {
      let isTouching = false;
      let previousTouchX = 0;

      window.addEventListener(
        'touchstart',
        (event) => {
          if (event.touches.length === 1) {
            isTouching = true;
            previousTouchX = event.touches[0].clientX;
          }
        },
        false
      );

      window.addEventListener(
        'touchmove',
        (event) => {
          if (isTouching && event.touches.length === 1) {
            const touchX = event.touches[0].clientX;
            const deltaX = touchX - previousTouchX;
            previousTouchX = touchX;

            // Move paddle1 horizontally based on touch movement
            paddle1.position.x += deltaX * 0.001; // Adjust sensitivity as needed

            // Clamp paddle1 within the field boundaries
            const minX =
              Math.min(
                vertices[0].x,
                vertices[1].x,
                vertices[2].x,
                vertices[3].x
              ) + 0.05;
            const maxX =
              Math.max(
                vertices[0].x,
                vertices[1].x,
                vertices[2].x,
                vertices[3].x
              ) - 0.05;
            paddle1.position.x = THREE.MathUtils.clamp(
              paddle1.position.x,
              minX,
              maxX
            );
          }
        },
        false
      );

      window.addEventListener(
        'touchend',
        (event) => {
          isTouching = false;
        },
        false
      );
    }

    /**
     * Update the ball's position and handle collisions
     */
    function updateBall() {
      // Move the ball
      ball.position.add(ballVelocity);

      // Calculate field boundaries
      const minX = Math.min(
        vertices[0].x,
        vertices[1].x,
        vertices[2].x,
        vertices[3].x
      );
      const maxX = Math.max(
        vertices[0].x,
        vertices[1].x,
        vertices[2].x,
        vertices[3].x
      );
      const minZ = Math.min(
        vertices[0].z,
        vertices[1].z,
        vertices[2].z,
        vertices[3].z
      );
      const maxZ = Math.max(
        vertices[0].z,
        vertices[1].z,
        vertices[2].z,
        vertices[3].z
      );

      // Check collision with side walls (X-axis)
      if (ball.position.x <= minX + 0.01 || ball.position.x >= maxX - 0.01) {
        ballVelocity.x *= -1;
      }

      // Check collision with front and back walls (Z-axis)
      if (ball.position.z <= minZ + 0.01 || ball.position.z >= maxZ - 0.01) {
        ballVelocity.z *= -1;
      }

      // Check collision with paddles
      const paddle1Box = new THREE.Box3().setFromObject(paddle1);
      const paddle2Box = new THREE.Box3().setFromObject(paddle2);
      const ballBox = new THREE.Box3().setFromObject(ball);

      if (
        paddle1Box.intersectsBox(ballBox) ||
        paddle2Box.intersectsBox(ballBox)
      ) {
        ballVelocity.z *= -1;
      }

      // Optional: Implement scoring when the ball passes a paddle
      // You can reset the ball position and velocity here
    }

    /**
     * Render loop
     */
    renderer.setAnimationLoop(() => {
      // Perform hit testing and update reticle position
      const frame = renderer.xr.getFrame();
      if (frame) {
        const session = frame.session;
        const pose = frame.getViewerPose(referenceSpace);
        if (pose) {
          const view = pose.views[0];
          const viewport = renderer.xr
            .getSession()
            .renderState.baseLayer.getViewport(view);
          renderer.setSize(viewport.width, viewport.height);

          const hitTestResults = frame.getHitTestResults(hitTestSource);
          if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const hitPose = hit.getPose(referenceSpace);
            reticle.visible = true;
            reticle.matrix.fromArray(hitPose.transform.matrix);
          } else {
            reticle.visible = false;
          }
        }
      }

      // Update game elements if the game is active
      if (isGameActive) {
        updateBall();
      }

      // Render the scene
      renderer.render(scene, camera);
    });
  } catch (e) {
    console.error('Failed to start AR session:', e);
    onNoXRDevice();
  }
}
