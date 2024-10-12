// app.js

// XR globals.
const xrButton = document.getElementById('xr-button');
const statusDiv = document.getElementById('status');
let xrSession = null;
let xrRefSpace = null;
let xrHitTestSource = null;

// Three.js and WebGL globals.
let gl = null;
let renderer = null;
let scene = null;
let camera = null;

// Game variables.
let vertices = [];
let field = null;
let isFieldCreated = false;
let reticle = null;
let line = null;
let paddle1 = null;
let paddle2 = null;
let ball = null;
let ballVelocity = new THREE.Vector3(0.02, 0, 0.02);

function initXR() {
  if (navigator.xr) {
    navigator.xr
      .isSessionSupported('immersive-ar')
      .then((supported) => {
        if (supported) {
          xrButton.innerHTML = 'Enter AR';
          xrButton.disabled = false;
          xrButton.addEventListener('click', onButtonClicked);
        } else {
          xrButton.innerHTML = 'AR not supported';
        }
      })
      .catch((err) => {
        console.error('Error checking XR support:', err);
        xrButton.innerHTML = 'AR not supported';
      });
  } else {
    xrButton.innerHTML = 'WebXR not available';
  }
}

function onButtonClicked() {
  if (!xrSession) {
    navigator.xr
      .requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: document.getElementById('overlay') },
      })
      .then(onSessionStarted, (e) => {
        console.error('Failed to start AR session:', e);
        alert('Failed to start AR session. See console for details.');
      });
  } else {
    xrSession.end();
  }
}

function onSessionStarted(session) {
  xrSession = session;
  xrButton.innerHTML = 'Exit AR';

  session.addEventListener('end', onSessionEnded);
  session.addEventListener('select', onSelect);

  // Create a canvas and renderer.
  const canvas = document.createElement('canvas');
  canvas.id = 'canvas';
  document.body.appendChild(canvas);
  gl = canvas.getContext('webgl', { xrCompatible: true });
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    context: gl,
    alpha: true,
  });
  renderer.autoClear = false;

  // Initialize Three.js scene.
  setupThreeJS();

  // Set the WebXR session's render state.
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

  // Request a reference space.
  session.requestReferenceSpace('local').then((refSpace) => {
    xrRefSpace = refSpace;
    // Start the render loop.
    session.requestAnimationFrame(onXRFrame);
  });

  // Set up hit testing.
  session
    .requestReferenceSpace('viewer')
    .then((viewerSpace) => {
      session
        .requestHitTestSource({ space: viewerSpace })
        .then((hitTestSource) => {
          xrHitTestSource = hitTestSource;
        })
        .catch((err) => {
          console.error('Failed to create hit test source:', err);
        });
    })
    .catch((err) => {
      console.error('Failed to get viewer reference space:', err);
    });

  // Update UI.
  statusDiv.innerHTML = 'Tap to place 4 vertices.';
}

function onSessionEnded(event) {
  xrSession = null;
  xrButton.innerHTML = 'Enter AR';
  statusDiv.innerHTML = '';
  document.body.removeChild(document.getElementById('canvas'));
  gl = null;
  renderer = null;
  scene = null;
  camera = null;
  vertices = [];
  field = null;
  isFieldCreated = false;
  reticle = null;
  line = null;
  paddle1 = null;
  paddle2 = null;
  ball = null;
}

function onSelect(event) {
  if (reticle.visible && !isFieldCreated) {
    const position = new THREE.Vector3();
    position.setFromMatrixPosition(reticle.matrix);
    vertices.push(position.clone());

    console.log(`Vertex ${vertices.length} placed at:`, position);

    // Visual feedback: place a small sphere at the vertex
    const sphereGeometry = new THREE.SphereGeometry(0.01, 16, 16);
    const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.copy(position);
    scene.add(sphere);

    updateLine();

    if (vertices.length === 4) {
      createPongField();
      isFieldCreated = true;
      statusDiv.innerHTML = 'Pong field created!';
      console.log('Pong field created.');
      // Initialize game elements
      createPaddles();
      createBall();
    } else {
      statusDiv.innerHTML = `Vertex ${vertices.length}/4 placed`;
    }
  }
}

function setupThreeJS() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera();
  scene.add(camera);

  // Add a directional light
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(0, 10, 0);
  scene.add(light);

  // Reticle for hit testing
  const ringGeometry = new THREE.RingGeometry(0.05, 0.07, 32).rotateX(
    -Math.PI / 2
  );
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  reticle = new THREE.Mesh(ringGeometry, ringMaterial);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
}

function createPongField() {
  // Remove the line connecting the vertices
  if (line) {
    scene.remove(line);
    line = null;
  }

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

  console.log('Pong field added to the scene.');
}

function updateLine() {
  if (line) {
    scene.remove(line);
  }

  if (vertices.length > 1) {
    const points = vertices.slice();
    if (vertices.length === 4) {
      points.push(vertices[0]); // Close the loop
    }

    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffff00 });
    line = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(line);

    console.log('Connecting lines updated.');
  }
}

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

  // Paddle 1 (User-controlled)
  paddle1 = new THREE.Mesh(paddleGeometry, paddleMaterial);
  paddle1.position.copy(side1Center);
  paddle1.lookAt(vertices[1]); // Align paddle with the field
  scene.add(paddle1);

  // Paddle 2 (Static or AI-controlled for now)
  paddle2 = new THREE.Mesh(paddleGeometry, paddleMaterial);
  paddle2.position.copy(side2Center);
  paddle2.lookAt(vertices[3]); // Align paddle with the field
  scene.add(paddle2);

  console.log('Paddles created.');
}

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

  console.log('Ball created at center:', center);
}

function onXRFrame(t, frame) {
  let session = frame.session;
  session.requestAnimationFrame(onXRFrame);

  // Update viewport.
  let pose = frame.getViewerPose(xrRefSpace);
  if (pose) {
    const glLayer = session.renderState.baseLayer;
    renderer.setSize(
      glLayer.framebufferWidth,
      glLayer.framebufferHeight,
      false
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    renderer.clear();

    // Update camera matrices.
    for (const view of pose.views) {
      const viewport = glLayer.getViewport(view);
      renderer.setViewport(
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height
      );

      camera.matrix.fromArray(view.transform.matrix);
      camera.projectionMatrix.fromArray(view.projectionMatrix);
      camera.updateMatrixWorld(true);

      // Perform hit testing.
      if (xrHitTestSource && !isFieldCreated) {
        const hitTestResults = frame.getHitTestResults(xrHitTestSource);
        if (hitTestResults.length > 0) {
          const hitPose = hitTestResults[0].getPose(xrRefSpace);
          reticle.visible = true;
          reticle.matrix.fromArray(hitPose.transform.matrix);
        } else {
          reticle.visible = false;
        }
      } else {
        reticle.visible = false;
      }

      // Render the scene.
      renderer.render(scene, camera);
    }
  }

  // Update game elements if the field is created.
  if (isFieldCreated) {
    updateBall();
  }
}

function updateBall() {
  if (!ball) return;

  // Move the ball.
  ball.position.add(ballVelocity);

  // Define field boundaries.
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
    console.log('Ball bounced on X-axis.');
  }

  // Check collision with front and back walls (Z-axis)
  if (ball.position.z <= minZ + 0.01 || ball.position.z >= maxZ - 0.01) {
    ballVelocity.z *= -1;
    console.log('Ball bounced on Z-axis.');
  }

  // Check collision with paddles
  const paddle1Box = new THREE.Box3().setFromObject(paddle1);
  const paddle2Box = new THREE.Box3().setFromObject(paddle2);
  const ballBox = new THREE.Box3().setFromObject(ball);

  if (paddle1Box.intersectsBox(ballBox)) {
    ballVelocity.z *= -1;
    console.log('Ball hit Paddle 1.');
  }

  if (paddle2Box.intersectsBox(ballBox)) {
    ballVelocity.z *= -1;
    console.log('Ball hit Paddle 2.');
  }

  // Optional: Implement scoring when the ball goes beyond paddles
}

initXR();
