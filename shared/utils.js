window.gltfLoader = new THREE.GLTFLoader();
/**
 * The Reticle class creates an object that displays a ring
 * along a found horizontal surface.
 */
class Reticle extends THREE.Object3D {
  constructor() {
    super();

    this.loader = new THREE.GLTFLoader();
    this.loader.load(
      'https://immersive-web.github.io/webxr-samples/media/gltf/reticle/reticle.gltf',
      (gltf) => {
        this.add(gltf.scene);
      }
    );

    this.visible = false;
  }
}

window.DemoUtils = {
  /**
   * Creates a THREE.Scene containing lights that cast shadows,
   * and a mesh that will receive shadows.
   *
   * @return {THREE.Scene}
   */
  createLitScene() {
    const scene = new THREE.Scene();

    // Add ambient light
    const light = new THREE.AmbientLight(0xffffff, 1);
    // Add directional light for shadows
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight.position.set(10, 15, 10);
    directionalLight.castShadow = true;

    // Create a large plane to receive shadows
    const planeGeometry = new THREE.PlaneGeometry(2000, 2000);
    planeGeometry.rotateX(-Math.PI / 2);

    const shadowMesh = new THREE.Mesh(
      planeGeometry,
      new THREE.ShadowMaterial({
        color: 0x111111,
        opacity: 0.2,
      })
    );

    shadowMesh.name = 'shadowMesh';
    shadowMesh.receiveShadow = true;
    shadowMesh.position.y = 10000;

    // Add elements to the scene
    scene.add(shadowMesh);
    scene.add(light);
    scene.add(directionalLight);

    return scene;
  },
};

function onNoXRDevice() {
  document.body.classList.add('unsupported');
}
