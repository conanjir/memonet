console.log('D3 version', d3.version);

// Define rScale at the top of the script
const rScale = d3.scaleSqrt().domain([1, 100]).range([4, 50]); // Adjust domain and range as needed

document.addEventListener('DOMContentLoaded', () => {
  // ─── 1) Define your viewport dimensions immediately ─────
  let width = window.innerWidth;
  let height = window.innerHeight;

  // ─── 2) Grab your SVG and size it ───────────────────────
  const svg = d3.select('#viz')
    .attr('width', width)
    .attr('height', height);

  // ─── 3) Create the 'view' container before zoomBehavior ─
  const view = svg.append('g').attr('class', 'view');
  const linkGroup = view.append('g').attr('class', 'links');
  const nodeGroup = view.append('g').attr('class', 'nodes');

  // ─── 4) Set up zoom behavior ────────────────────────────
  const zoomBehavior = d3.zoom()
    .filter(event => event.type === 'wheel' || (event.type.startsWith('touch') && event.touches.length === 2))
    .scaleExtent([0.1, 10])
    .on('zoom', (event) => {
      view.attr('transform', event.transform);
    });

  svg.call(zoomBehavior);

  // ─── 5) Wire up auto-centering and helpers ──────────────
  let autoCentering = true;
  d3.select('#toggleCentering').on('click', () => {
    autoCentering = !autoCentering;
    if (autoCentering && nodes.length) focusOnNode(getLargestNode());
  });

  function getLargestNode() {
    return nodes.reduce((max, n) => n.r > max.r ? n : max, nodes[0]);
  }

  function focusOnNode(node) {
    const cur = d3.zoomTransform(svg.node());
    const targetX = width / 2 - node.x * cur.k;
    const targetY = height / 2 - node.y * cur.k;

    view.attr('transform', `translate(${targetX},${targetY}) scale(${cur.k})`);
  }

  function updateCenterNode() {
    if (!autoCentering || nodes.length === 0) return;

    const largestNode = getLargestNode();
    centerNode = largestNode; // Always update the centerNode
  }

  // Cache DOM elements
  const body = d3.select('body');

  // Initialize info box
  const infoBox = body.insert('div', ':first-child')
    .attr('id', 'info-box')
    .text('🔍 Scan your UniMelb ID to interact with the visualisation! Biggest node by 6pm gets a cookie');

  // Initialize info box for the last scanned node
  const lastNodeInfoBox = body.append('div')
    .attr('id', 'last-node-info')
    .style('position', 'fixed')
    .style('bottom', '10px')
    .style('left', '50%')
    .style('transform', 'translateX(-50%)')
    .style('background', 'rgba(0, 0, 0, 0.9)')
    .style('padding', '10px')
    .style('border-radius', '5px')
    .style('box-shadow', '0 2px 5px rgba(0, 0, 0, 0.2)')
    .style('display', 'none'); // Initially hidden

  lastNodeInfoBox.append('p')
    .attr('id', 'last-node-uid')
    .style('margin', '0')
    .style('font-weight', 'bold');

  const displayNameElement = lastNodeInfoBox.append('p')
    .attr('id', 'last-node-display-name')
    .style('margin', '0')
    .style('cursor', 'pointer')
    .style('text-decoration', 'underline')
    .style('color', 'red')
    .text('Click to edit');

  // Function to update the info box with the last scanned node's details
  function updateLastNodeInfo(node) {
    if (!node) {
      lastNodeInfoBox.style('display', 'none');
      return;
    }

    lastNodeInfoBox.style('display', 'block');
    d3.select('#last-node-uid').text(`UID: ${node.id}`);
    d3.select('#last-node-display-name').text(`Display Name: ${node.displayName || 'Unnamed'}`);
  }

  // Add click handler to edit the display name
  displayNameElement.on('click', () => {
    if (!lastId) return;

    const node = nodes.find(n => n.id === lastId);
    if (!node) return;

    const newName = prompt(`Rename node "${node.displayName || node.id}" to:`, node.displayName || node.id);
    if (newName?.trim()) {
      node.displayName = newName.trim();
      updateLastNodeInfo(node);

      // Update the display name in the graph
      nodeGroup.selectAll('text')
        .filter(d => d === node)
        .text(d => d.displayName || d.id);
    }
  });

  // Viewport and state variables
  const nodes = [];
  const links = [];
  let lastId = null;
  let centerNode = null;
  let targetCenterNode = null;
  let cameraX = width / 2;
  let cameraY = height / 2;
  let animationId = null;

  // Performance optimization flags
  let needsLeaderboardUpdate = true;
  let lastUpdateTime = 0;
  const UPDATE_INTERVAL = 16; // ~60fps

  // ——— 2. Define the gravitational force ———
  const G = 1; // tweak this for stronger/weaker attraction

  function forceGravity(alpha) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const minDist = a.r + b.r;
        if (dist < minDist) dist = minDist;

        const F = (G * a.mass * b.mass) / (dist * dist);
        const ax = (F / a.mass) * (dx / dist) * alpha;
        const ay = (F / a.mass) * (dy / dist) * alpha;
        const bx = (F / b.mass) * (dx / dist) * alpha;
        const by = (F / b.mass) * (dy / dist) * alpha;

        a.vx += ax;
        a.vy += ay;
        b.vx -= bx;
        b.vy -= by;
      }
    }
  }

  // tweak this to dial the overall orbital intensity
  const ORBIT_BASE = 0.05;
  const RADIAL_STRENGTH = 0.01;

  function forceOrbitDynamic(alpha) {
    links.forEach(({ source, target }) => {
      const hub = source.mass > target.mass ? source : target;
      const sat = hub === source ? target : source;

      const dx = sat.x - hub.x;
      const dy = sat.y - hub.y;
      const dist = Math.hypot(dx, dy) || 1;

      // tangential force
      const ux = -dy / dist, uy = dx / dist; // Perpendicular unit vector
      const rel = (hub.mass - sat.mass) / hub.mass;
      const orbitForce = ORBIT_BASE * rel * alpha;
      sat.vx += ux * orbitForce;
      sat.vy += uy * orbitForce;

      // radial pull (acts like a weak spring)
      const desired = hub.r + sat.r + 20; // gap = 20px
      const dr = dist - desired;
      const k = RADIAL_STRENGTH * alpha;
      sat.vx -= (dx / dist) * dr * k;
      sat.vy -= (dy / dist) * dr * k;
    });
  }

  // ——— 3. Reconfigure your simulation ———
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links)
      .id(d => d.id)
      .distance(300)
      .strength(0.05)) // weaker springs let gravity dominate
    .force('collide', d3.forceCollide(d => d.r + 0.1).iterations(3)) // Increase iterations
    .force('gravity', forceGravity) // custom gravity
    .force('orbitDynamic', forceOrbitDynamic)
    .alphaMin(0.01) // Prevent alpha from decaying completely
    .velocityDecay(0.1) // Lower decay for smoother motion
    .on('tick', ticked)
    .on('end', () => {
      if (autoCentering) focusOnNode(getLargestNode());
    });

  // Adjust simulation alpha decay to allow stabilization
  simulation.alphaDecay(0.1); // Increase decay rate for faster stabilization

  // Create groups once

  // Optimized tick function with boundary constraints and collision prevention
  function ticked() {
    const MAX_VELOCITY = 2;
    const DAMPING_FACTOR = 0.9;

    sanitizePositions();

    nodes.forEach(node => {
      node.vx = (node.vx || 0) * DAMPING_FACTOR;
      node.vy = (node.vy || 0) * DAMPING_FACTOR;
      node.vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, node.vx));
      node.vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, node.vy));
      node.x += node.vx;
      node.y += node.vy;
    });

    nodeGroup.selectAll('g.node')
      .attr('transform', d => `translate(${d.x},${d.y})`);
    linkGroup.selectAll('line')
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    if (autoCentering && centerNode) {
      focusOnNode(centerNode); // Continuously follow the largest node
    }
  }

  // Audio management with object pooling
  const audioPool = {
    node1: [],
    node2: [],
    node3: [],
    node4: [],
    tag: []
  };

  function getAudio(type) {
    const pool = audioPool[type];
    let audio = pool.find(a => a.ended || a.paused);
    if (!audio) {
      audio = new Audio(`assets/${type === 'tag' ? 'memonet_nodepop' : type}.wav`);
      audio.volume = 0.3; // Reduce volume
      pool.push(audio);
    }
    return audio;
  }

  // Audio management with a flag to prevent overlapping sounds
  let isSoundPlaying = false;

  function playSound(type, node = null) {
    if (isSoundPlaying) return; // Prevent overlapping sounds
    try {
      const audio = getAudio(type);

      // Remove pitch scaling logic
      audio.playbackRate = 1.0; // Default pitch for all sounds

      isSoundPlaying = true;
      audio.currentTime = 0;
      audio.play().then(() => {
        audio.onended = () => {
          isSoundPlaying = false; // Reset flag when sound finishes
        };
      }).catch(err => {
        console.warn('Audio play failed:', err);
        isSoundPlaying = false; // Reset flag on failure
      });
    } catch (e) {
      console.warn('Audio play failed:', e);
      isSoundPlaying = false; // Reset flag on exception
    }
  }

  // Optimized node feature unlocking
  function unlockFeaturesForNode(node) {
    // Check sound thresholds efficiently
    if (!node.soundPlayed25 && node.r >= 25) {
      playSound('node1');
      node.soundPlayed25 = true;
    }

    // Handle renaming
    const newName = prompt(`Rename node "${node.displayName || node.id}" to:`, node.displayName || node.id);
    if (newName?.trim()) {
      node.displayName = newName.trim();
      // Update only the specific text element
      nodeGroup.selectAll('text')
        .filter(d => d === node)
        .text(d => d.displayName || d.id);
      needsLeaderboardUpdate = true;
    }
  }

  // Optimized graph update with better performance
  function updateGraph() {
    // Update link opacities
    const maxWeight = d3.max(links, l => l.weight) || 1;
    const opacityScale = d3.scaleLinear().domain([1, maxWeight]).range([0.3, 1]);

    links.forEach(l => l.opacity = opacityScale(l.weight));

    // Update links
    linkGroup.selectAll('line')
      .data(links, d => `${d.source.id}-${d.target.id}`)
      .join(
        enter => enter.append('line')
          .attr('class', 'link')
          .attr('stroke-width', 1)
          .attr('stroke', '#999')
          .attr('stroke-opacity', 0),
        update => update,
        exit => exit.remove()
      )
      .attr('stroke-opacity', d => d.opacity)
      .attr('x1', d => (d.source.x || 0)) // Default to 0 if NaN
      .attr('y1', d => (d.source.y || 0)) // Default to 0 if NaN
      .attr('x2', d => (d.target.x || 0)) // Default to 0 if NaN
      .attr('y2', d => (d.target.y || 0)); // Default to 0 if NaN

    // Update nodes with optimized enter/update/exit
    const nodeSelection = nodeGroup.selectAll('g.node')
      .data(nodes, d => d.id);

    const nodeEnter = nodeSelection.enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x || width / 2},${d.y || height / 2})`)
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

    // Add circles
    nodeEnter.append('circle')
      .attr('r', 0)
      .attr('fill', 'white')
      .transition()
      .duration(1000)
      .attr('r', d => { setNodeRadius(d); return d.r; });

    // Add text labels
    nodeEnter.append('text')
      .attr('dy', '0.35em')
      .attr('x', d => d.r + 5)
      .attr('text-anchor', 'start')
      .attr('font-size', '12px')
      .attr('fill', '#333')
      .text(d => d.displayName || d.id);

    // Add click handlers
    nodeEnter.on('click', (event, d) => {
      event.stopPropagation();
      unlockFeaturesForNode(d);
    });

    // Update existing nodes
    const nodeUpdate = nodeSelection.merge(nodeEnter);

    nodeUpdate.select('circle')
      .transition()
      .duration(300)
      .attr('r', d => d.r);

    nodeUpdate.select('text')
      .attr('x', d => d.r + 5)
      .text(d => d.displayName || d.id);

    nodeSelection.exit().remove();

    // Handle sound effects efficiently
    nodes.forEach(d => {
      if (!d.soundPlayed25 && d.r >= 25) {
        playSound('node1');
        d.soundPlayed25 = true;
      }
      if (!d.soundPlayed50 && d.r >= 50) {
        playSound('node2');
        d.soundPlayed50 = true;
      }
      if (!d.soundPlayed100 && d.r >= 100) {
        playSound('node3');
        d.soundPlayed100 = true;
      }
      if (!d.soundPlayed200 && d.r >= 200) {
        playSound('node4');
        d.soundPlayed200 = true;
      }
    });

    // Highlight last scanned node
    nodeGroup.selectAll('circle')
      .attr('fill', d => d.id === lastId ? 'red' : 'white');

    // Update simulation
    simulation.nodes(nodes);
    simulation.force('link').links(links);

    // Center the biggest node
    updateCenterNode();

    needsLeaderboardUpdate = true;
    
    saveState();
  }

  // Create leaderboards
  const leaderboardSize = body.append('div')
    .attr('id', 'leaderboard-size')
    .style('position', 'fixed')
    .style('top', '10px')
    .style('right', '10px')
    .style('background', 'rgba(0,0,0,0.9)')
    .style('padding', '10px')
    .style('border-radius', '5px');
  leaderboardSize.append('h3').text('Size Leaders');
  const leaderboardSizeList = leaderboardSize.append('ul').style('list-style', 'none').style('padding', '0');

  const leaderboardLinks = body.append('div')
    .attr('id', 'leaderboard-links')
    .style('position', 'fixed')
    .style('top', '360px')
    .style('right', '10px')
    .style('background', 'rgba(0,0,0,0.9)')
    .style('padding', '10px')
    .style('border-radius', '5px');
  leaderboardLinks.append('h3').text('Connection Leaders');
  const leaderboardLinksList = leaderboardLinks.append('ul').style('list-style', 'none').style('padding', '0');

  // Optimized leaderboard updates (throttled)
  function updateLeaderboards() {
    if (!needsLeaderboardUpdate) return;

    // Update node link counts
    const linkCounts = new Map();
    links.forEach(link => {
      const sourceId = link.source.id || link.source;
      const targetId = link.target.id || link.target;

      linkCounts.set(sourceId, (linkCounts.get(sourceId) || 0) + 1);
      linkCounts.set(targetId, (linkCounts.get(targetId) || 0) + 1);
    });

    nodes.forEach(node => {
      node.links = linkCounts.get(node.id) || 0;
    });

    // Update size leaderboard
    const sortedBySize = [...nodes].sort((a, b) => b.r - a.r).slice(0, 10); // Top 10 by size
    leaderboardSizeList.selectAll('li')
      .data(sortedBySize, d => d.id)
      .join(
        enter => {
          const li = enter.append('li')
            .style('display', 'flex')
            .style('justify-content', 'space-between')
            .style('margin', '2px 0');
          li.append('span').attr('class', 'rank').style('width', '20px');
          li.append('span').attr('class', 'uid').style('flex', '1').style('overflow', 'hidden');
          li.append('span').attr('class', 'size').style('width', '40px').style('text-align', 'right');
          return li;
        }
      )
      .each(function (d, i) {
        const li = d3.select(this);
        li.select('.rank').text(i + 1);
        li.select('.uid').text(d.displayName || d.id);
        li.select('.size').text(d.r.toFixed(1));
      });

    // Update links leaderboard
    const sortedByLinks = [...nodes].sort((a, b) => (b.links || 0) - (a.links || 0)).slice(0, 10); // Top 10 by links
    leaderboardLinksList.selectAll('li')
      .data(sortedByLinks, d => d.id)
      .join(
        enter => {
          const li = enter.append('li')
            .style('display', 'flex')
            .style('justify-content', 'space-between')
            .style('margin', '2px 0');
          li.append('span').attr('class', 'rank').style('width', '20px');
          li.append('span').attr('class', 'uid').style('flex', '1').style('overflow', 'hidden');
          li.append('span').attr('class', 'links').style('width', '40px').style('text-align', 'right');
          return li;
        }
      )
      .each(function (d, i) {
        const li = d3.select(this);
        li.select('.rank').text(i + 1);
        li.select('.uid').text(d.displayName || d.id);
        li.select('.links').text(d.links || 0);
      });

    needsLeaderboardUpdate = false;
  }

  // Main animation loop with throttling
  function animationLoop() {
    const now = Date.now();

    if (now - lastUpdateTime >= UPDATE_INTERVAL) {
      if (autoCentering && nodes.length) {
        updateCenterNode(); // Continuously update centering
      }
      updateLeaderboards();

      // Update node positions
      nodeGroup.selectAll('g.node')
        .attr('transform', d => `translate(${d.x},${d.y})`);

      // Update link positions
      linkGroup.selectAll('line')
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      lastUpdateTime = now;

      // Reheat the simulation periodically
      if (simulation.alpha() < 0.03) {
        simulation.alpha(0.08).restart();
      }
    }

    animationId = requestAnimationFrame(animationLoop);
  }

  // Start the animation loop
  animationLoop();

  // Drag handlers
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x; // Fix the node's position during dragging
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x; // Update the fixed position to follow the drag
    d.fy = event.y;
  }

  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null; // Allow the node to move freely again
    d.fy = null;
    // Ensure velocities are not reset to zero
    d.vx = d.vx || 0;
    d.vy = d.vy || 0;
  }

  // Window resize handler
  window.addEventListener('resize', () => {
    width = window.innerWidth;
    height = window.innerHeight;

    svg
      .attr('width', width)
      .attr('height', height);

    // Optional: re-center on the current largest node
    if (autoCentering && nodes.length) {
      focusOnNode(getLargestNode(), 1.2);
    }
  });

  // Serial connection setup
  const connectBtn = document.getElementById('connect');
  const warning = document.getElementById('warning');

  if (!('serial' in navigator)) {
    connectBtn.disabled = true;
    warning.textContent = '⚠️ Web Serial API not supported.';
  }

  connectBtn.addEventListener('click', async () => {
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });

      const reader = port.readable.pipeThrough(new TextDecoderStream()).getReader();
      connectBtn.disabled = true;
      warning.textContent = '🔌 Connected';

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        for (const raw of lines) {
          const text = raw.replace(/^"|"$/g, '').trim();
          if (!text) continue;
          let id;
          if (text.startsWith('UID:')) {
            id = text.slice(4).replace(/\s+/g, '');
          } else if (text.startsWith('{') && text.endsWith('}')) {
            try {
              const msg = JSON.parse(text);
              id = msg.id;
            } catch (err) {
              console.error('JSON parse error:', err);
              continue;
            }
          } else {
            continue;
          }

          // Handle new scan
          let node = nodes.find(n => n.id === id);
          if (node) {
            node.count++;
            setNodeRadius(node);
          } else {
            // Spawn new nodes at a valid position within the viewport
            const spawnX = cameraX + width / 2; // Center horizontally
            const spawnY = cameraY + height / 2; // Center vertically
            node = {
              id,
              count: 1,
              r: rScale(1),
              x: spawnX || width / 2, // Default to center if NaN
              y: spawnY || height / 2, // Default to center if NaN
              displayName: null,
              soundPlayed25: false,
              soundPlayed50: false,
              soundPlayed100: false,
              soundPlayed200: false,
            };
            setNodeRadius(node);
            nodes.push(node);
          }

          // Play the scan sound with pitch adjustment
          playSound('tag', node);

          // Create link to previous node
          if (lastId && lastId !== id) {
            const existingLink = links.find(l =>
              (l.source.id === lastId && l.target.id === id) ||
              (l.source.id === id && l.target.id === lastId)
            );
            if (existingLink) {
              existingLink.weight++;
            } else {
              const sourceNode = nodes.find(n => n.id === lastId);
              const targetNode = nodes.find(n => n.id === id);
              if (sourceNode && targetNode) {
                links.push({ source: sourceNode, target: targetNode, weight: 1 });
              }
            }
          }

          lastId = id;
          updateLastNodeInfo(node); // Update the info box with the last scanned node
          updateGraph();
        }
      }
    } catch (err) {
      console.error('Serial connection error:', err);
      warning.textContent = '❌ ' + err.message;
    }
  });

  // State management
  function saveState() {
    try {
      const state = {
        savedNodes: nodes.map(({ id, count, r, x, y, displayName }) => ({
          id, count, r, x, y, displayName
        })),
        savedLinks: links.map(({ source, target, weight }) => ({
          source: source.id || source,
          target: target.id || target,
          weight
        }))
      };
      localStorage.setItem('graphState', JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state:', e);
    }
  }

  function loadState() {
    try {
      const savedState = localStorage.getItem('graphState');
      if (savedState) {
        const { savedNodes, savedLinks } = JSON.parse(savedState);
        nodes.push(...savedNodes);
        savedLinks.forEach(link => {
          const sourceNode = nodes.find(n => n.id === link.source);
          const targetNode = nodes.find(n => n.id === link.target);
          if (sourceNode && targetNode) {
            links.push({ source: sourceNode, target: targetNode, weight: link.weight });
          }
        });
        updateGraph();
      }
    } catch (e) {
      console.warn('Failed to load state:', e);
    }
  }

  // Load initial state
  loadState();

  // Debug controls
  const connectButton = document.getElementById('connect');
  const debugMenu = document.getElementById('debug-menu');

  document.addEventListener('keydown', (event) => {
    switch (event.key) {
      case '0':
        const isHidden = connectButton.style.display === 'none';
        connectButton.style.display = isHidden ? 'block' : 'none';
        debugMenu.style.display = isHidden ? 'block' : 'none';
        warning.style.display = isHidden ? 'block' : 'none';
        break;
      case '1':
        const nodesVisible = nodeGroup.style('display') !== 'none';
        nodeGroup.style('display', nodesVisible ? 'none' : 'block');
        break;
      case '2':
        nodes.length = 0;
        links.length = 0;
        centerNode = null;
        targetCenterNode = null;
        cameraX = width / 2;
        cameraY = height / 2;
        updateGraph();
        console.log('Graph reset');
        break;
    }
  });

  // Initialize debug controls
  connectButton.style.display = 'block';
  debugMenu.style.display = 'block';

  // Slider controls
  const sliders = {
    distance: document.getElementById('distance'),
    strength: document.getElementById('strength'),
    speedFactor: document.getElementById('speedFactor')
  };

  // Distance slider
  if (sliders.distance) {
    const distanceValue = document.getElementById('distanceValue');
    sliders.distance.addEventListener('input', () => {
      const linkDistance = parseFloat(sliders.distance.value);
      distanceValue.textContent = linkDistance;

      // Update the link distance safely
      const linkForce = simulation.force('link');
      if (linkForce) {
        linkForce.distance(linkDistance);
        // simulation.alpha(0.1).restart();
      }
    });
  }

  // Strength slider
  if (sliders.strength) {
    const strengthValue = document.getElementById('strengthValue');
    sliders.strength.addEventListener('input', () => {
      const chargeStrength = parseFloat(sliders.strength.value);
      strengthValue.textContent = chargeStrength;
      // Smoothly transition the charge strength
      const currentForce = simulation.force('charge');
      const interpolatedForce = d3.forceManyBody().strength(d => {
        const currentStrength = currentForce.strength();
        return currentStrength + (chargeStrength - currentStrength) * 0.1; // Interpolate
      });
      simulation.force('charge', interpolatedForce);
    });
  }

  // Speed factor slider
  if (sliders.speedFactor) {
    const speedFactorValue = document.getElementById('speedFactorValue');
    sliders.speedFactor.addEventListener('input', () => {
      const speedFactor = parseFloat(sliders.speedFactor.value);
      speedFactorValue.textContent = speedFactor;
      // Clamp the speedFactor to avoid extreme values
      const clampedSpeedFactor = Math.max(0.01, Math.min(speedFactor, 0.99));
      // Smoothly transition the velocity decay
      const currentDecay = simulation.velocityDecay();
      const newDecay = currentDecay + (1 - clampedSpeedFactor - currentDecay) * 0.1; // Interpolate
      simulation.velocityDecay(newDecay);
    });
  }

  // Load/Save buttons
  const loadStateButton = document.getElementById('loadState');
  const saveStateButton = document.getElementById('saveState');

  if (loadStateButton) {
    loadStateButton.addEventListener('click', () => {
      loadState();
      alert('Game state loaded!');
    });
  }

  if (saveStateButton) {
    saveStateButton.addEventListener('click', () => {
      saveState();
      alert('Game state saved!');
    });
  }

  // Hash function for string IDs
  String.prototype.hashCode = function() {
    let hash = 0;
    for (let i = 0; i < this.length; i++) {
      const char = this.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  };

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    saveState();
  });

  // ——— 1. When you create or resize a node, give it a mass ———
  function setNodeRadius(node) {
    node.r = rScale(node.count);
    node.mass = Math.PI * Math.pow(node.r, 2); // area-based mass
  }

  // Ensure valid positions for nodes and links before rendering
  function sanitizePositions() {
    nodes.forEach(node => {
      // Only correct invalid positions (e.g., NaN values)
      if (isNaN(node.x) || isNaN(node.y)) {
        node.x = width / 2; // Default to center if NaN
        node.y = height / 2;
      }
      if (isNaN(node.vx) || isNaN(node.vy)) {
        node.vx = 0; // Default velocity to 0 if NaN
        node.vy = 0;
      }
    });

    links.forEach(link => {
      if (!link.source.x || !link.source.y) {
        link.source.x = width / 2; // Default source position to center if NaN
        link.source.y = height / 2;
      }
      if (!link.target.x || !link.target.y) {
        link.target.x = width / 2; // Default target position to center if NaN
        link.target.y = height / 2;
      }
    });
  }
});