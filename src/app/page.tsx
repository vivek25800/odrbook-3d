'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Play, Pause, RotateCcw, Filter, Settings, Moon, Sun } from 'lucide-react';

// Types
interface OrderbookLevel {
  price: number;
  quantity: number;
  timestamp: number;
}

interface OrderbookData {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  lastUpdateId: number;
}

interface Venue {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
}

interface PressureZone {
  price: number;
  quantity: number;
  intensity: number;
  type: 'bid' | 'ask';
}

interface HistoricalData {
  timestamp: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}

// Custom hooks
const useOrderbookWebSocket = (symbol: string = 'BTCUSDT') => {
  const [orderbook, setOrderbook] = useState<OrderbookData>({ bids: [], asks: [], lastUpdateId: 0 });
  const [historicalData, setHistoricalData] = useState<HistoricalData[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const orderbookRef = useRef<OrderbookData>({ bids: [], asks: [], lastUpdateId: 0 });

  const initializeOrderbook = useCallback(async () => {
    try {
      const response = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`);
      const data = await response.json();
      
      const initialOrderbook: OrderbookData = {
        bids: data.bids.map(([price, quantity]: [string, string]) => ({
          price: parseFloat(price),
          quantity: parseFloat(quantity),
          timestamp: Date.now()
        })),
        asks: data.asks.map(([price, quantity]: [string, string]) => ({
          price: parseFloat(price),
          quantity: parseFloat(quantity),
          timestamp: Date.now()
        })),
        lastUpdateId: data.lastUpdateId
      };
      
      orderbookRef.current = initialOrderbook;
      setOrderbook(initialOrderbook);
      
      // Initialize historical data
      setHistoricalData([{
        timestamp: Date.now(),
        bids: initialOrderbook.bids.slice(0, 20),
        asks: initialOrderbook.asks.slice(0, 20)
      }]);
    } catch (err) {
      setError('Failed to initialize orderbook');
      console.error(err);
    }
  }, [symbol]);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@depth`);
      
      ws.onopen = () => {
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const timestamp = Date.now();
        
        if (data.U <= orderbookRef.current.lastUpdateId) return;

        const updatedOrderbook = { ...orderbookRef.current };
        
        // Update bids
        data.b?.forEach(([price, quantity]: [string, string]) => {
          const priceNum = parseFloat(price);
          const quantityNum = parseFloat(quantity);
          const index = updatedOrderbook.bids.findIndex(bid => bid.price === priceNum);
          
          if (quantityNum === 0) {
            if (index !== -1) updatedOrderbook.bids.splice(index, 1);
          } else {
            const level = { price: priceNum, quantity: quantityNum, timestamp };
            if (index !== -1) {
              updatedOrderbook.bids[index] = level;
            } else {
              updatedOrderbook.bids.push(level);
              updatedOrderbook.bids.sort((a, b) => b.price - a.price);
            }
          }
        });

        // Update asks
        data.a?.forEach(([price, quantity]: [string, string]) => {
          const priceNum = parseFloat(price);
          const quantityNum = parseFloat(quantity);
          const index = updatedOrderbook.asks.findIndex(ask => ask.price === priceNum);
          
          if (quantityNum === 0) {
            if (index !== -1) updatedOrderbook.asks.splice(index, 1);
          } else {
            const level = { price: priceNum, quantity: quantityNum, timestamp };
            if (index !== -1) {
              updatedOrderbook.asks[index] = level;
            } else {
              updatedOrderbook.asks.push(level);
              updatedOrderbook.asks.sort((a, b) => a.price - b.price);
            }
          }
        });

        updatedOrderbook.lastUpdateId = data.u;
        orderbookRef.current = updatedOrderbook;
        setOrderbook(updatedOrderbook);
        
        // Update historical data (keep last 60 snapshots for time dimension)
        setHistoricalData(prev => {
          const newSnapshot = {
            timestamp,
            bids: updatedOrderbook.bids.slice(0, 20),
            asks: updatedOrderbook.asks.slice(0, 20)
          };
          const updated = [...prev, newSnapshot];
          return updated.slice(-60); // Keep last 60 snapshots
        });
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
        setConnected(false);
      };

      ws.onclose = () => {
        setConnected(false);
        setTimeout(() => connectWebSocket(), 3000);
      };

      wsRef.current = ws;
    } catch (err) {
      setError('Failed to connect to WebSocket');
      setConnected(false);
    }
  }, [symbol]);

  useEffect(() => {
    initializeOrderbook().then(() => {
      connectWebSocket();
    });

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [initializeOrderbook, connectWebSocket]);

  return { orderbook, historicalData, connected, error };
};

// Three.js Visualization Component
const ThreeJSVisualization: React.FC<{
  orderbook: OrderbookData;
  historicalData: HistoricalData[];
  isRotating: boolean;
  showPressureZones: boolean;
  darkMode: boolean;
}> = ({ orderbook, historicalData, isRotating, showPressureZones, darkMode }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (!mountRef.current || typeof window === 'undefined') return;

    // Dynamically import Three.js to avoid SSR issues
    const initThreeJS = async () => {
      const THREE = await import('three');
      
      // Scene setup
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(darkMode ? 0x1a1a2e : 0xf8f9fa);
      
      // Camera setup
      const camera = new THREE.PerspectiveCamera(75, mountRef.current!.clientWidth / mountRef.current!.clientHeight, 0.1, 1000);
      camera.position.set(25, 20, 25);
      camera.lookAt(0, 0, 0);
      
      // Renderer setup
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(mountRef.current!.clientWidth, mountRef.current!.clientHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      mountRef.current!.appendChild(renderer.domElement);
      
      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
      scene.add(ambientLight);
      
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(50, 50, 50);
      directionalLight.castShadow = true;
      directionalLight.shadow.mapSize.width = 2048;
      directionalLight.shadow.mapSize.height = 2048;
      scene.add(directionalLight);
      
      const pointLight = new THREE.PointLight(0x4fc3f7, 0.6);
      pointLight.position.set(-30, 20, -30);
      scene.add(pointLight);
      
      // Create coordinate system
      const axesHelper = new THREE.AxesHelper(15);
      scene.add(axesHelper);
      
      // Create grid for better visualization
      const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
      scene.add(gridHelper);
      
      // Add axis labels using sprites
      const createTextSprite = (text: string, color: string = '#ffffff') => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.width = 256;
        canvas.height = 64;
        
        context.fillStyle = color;
        context.font = '24px Arial';
        context.textAlign = 'center';
        context.fillText(text, 128, 40);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(4, 1, 1);
        return sprite;
      };
      
      // Add axis labels
      const xLabel = createTextSprite('Price', '#ff6b6b');
      xLabel.position.set(20, -2, 0);
      scene.add(xLabel);
      
      const yLabel = createTextSprite('Quantity', '#4ecdc4');
      yLabel.position.set(0, 20, 0);
      scene.add(yLabel);
      
      const zLabel = createTextSprite('Time', '#45b7d1');
      zLabel.position.set(0, -2, 20);
      scene.add(zLabel);
      
      // Store references
      sceneRef.current = scene;
      rendererRef.current = renderer;
      cameraRef.current = camera;
      
      // Controls (basic mouse interaction)
      let mouseDown = false;
      let mouseX = 0;
      let mouseY = 0;
      let targetRotationX = 0;
      let targetRotationY = 0;
      let currentRotationX = 0;
      let currentRotationY = 0;
      
      const onMouseDown = (event: MouseEvent) => {
        mouseDown = true;
        mouseX = event.clientX;
        mouseY = event.clientY;
      };
      
      const onMouseUp = () => {
        mouseDown = false;
      };
      
      const onMouseMove = (event: MouseEvent) => {
        if (!mouseDown) return;
        
        const deltaX = event.clientX - mouseX;
        const deltaY = event.clientY - mouseY;
        
        targetRotationY += deltaX * 0.01;
        targetRotationX += deltaY * 0.01;
        targetRotationX = Math.max(-Math.PI/2, Math.min(Math.PI/2, targetRotationX));
        
        mouseX = event.clientX;
        mouseY = event.clientY;
      };
      
      const onWheel = (event: WheelEvent) => {
        const scaleFactor = 1 + event.deltaY * 0.001;
        camera.position.multiplyScalar(scaleFactor);
        camera.position.x = Math.max(-100, Math.min(100, camera.position.x));
        camera.position.y = Math.max(5, Math.min(100, camera.position.y));
        camera.position.z = Math.max(-100, Math.min(100, camera.position.z));
      };
      
      renderer.domElement.addEventListener('mousedown', onMouseDown);
      renderer.domElement.addEventListener('mouseup', onMouseUp);
      renderer.domElement.addEventListener('mousemove', onMouseMove);
      renderer.domElement.addEventListener('wheel', onWheel);
      
      // Animation loop
      const animate = () => {
        frameRef.current = requestAnimationFrame(animate);
        
        // Smooth rotation
        currentRotationX += (targetRotationX - currentRotationX) * 0.1;
        currentRotationY += (targetRotationY - currentRotationY) * 0.1;
        
        if (isRotating) {
          targetRotationY += 0.005;
        }
        
        // Update camera position based on rotation
        const radius = Math.sqrt(
          camera.position.x * camera.position.x + 
          camera.position.z * camera.position.z
        );
        
        camera.position.x = radius * Math.cos(currentRotationY);
        camera.position.z = radius * Math.sin(currentRotationY);
        camera.position.y = Math.max(5, camera.position.y + currentRotationX * 5);
        
        camera.lookAt(0, 5, 0);
        
        renderer.render(scene, camera);
      };
      
      animate();
      
      // Handle resize
      const handleResize = () => {
        if (!mountRef.current) return;
        camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      };
      
      window.addEventListener('resize', handleResize);
      
      return () => {
        window.removeEventListener('resize', handleResize);
        renderer.domElement.removeEventListener('mousedown', onMouseDown);
        renderer.domElement.removeEventListener('mouseup', onMouseUp);
        renderer.domElement.removeEventListener('mousemove', onMouseMove);
        renderer.domElement.removeEventListener('wheel', onWheel);
      };
    };

    initThreeJS();

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      if (rendererRef.current && mountRef.current?.contains(rendererRef.current.domElement)) {
        mountRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, [darkMode]);

  // Update visualization when orderbook changes
  useEffect(() => {
    if (!sceneRef.current || typeof window === 'undefined' || historicalData.length === 0) return;

    const updateVisualization = async () => {
      const THREE = await import('three');
      const scene = sceneRef.current;
      
      // Clear previous bars
      const barsToRemove = scene.children.filter((child: any) => child.userData?.isOrderbookBar);
      barsToRemove.forEach((bar: any) => scene.remove(bar));
      
      // Get price range from current orderbook
      const allPrices = [...orderbook.bids, ...orderbook.asks].map(level => level.price);
      if (allPrices.length === 0) return;
      
      const priceRange = {
        min: Math.min(...allPrices),
        max: Math.max(...allPrices)
      };
      
      // Calculate max quantity for scaling
      const allQuantities = historicalData.flatMap(snapshot => 
        [...snapshot.bids, ...snapshot.asks].map(level => level.quantity)
      );
      const maxQuantity = Math.max(...allQuantities, 1);
      
      // Time range
      const timeRange = {
        min: Math.min(...historicalData.map(d => d.timestamp)),
        max: Math.max(...historicalData.map(d => d.timestamp))
      };
      
      // Create 3D bars for each time snapshot
      historicalData.forEach((snapshot, timeIndex) => {
        const timeProgress = historicalData.length > 1 ? timeIndex / (historicalData.length - 1) : 0;
        const zPosition = (timeProgress * 40) - 20; // Time axis (Z)
        
        // Create bid bars (green)
        snapshot.bids.slice(0, 20).forEach((bid, priceIndex) => {
          const xPosition = ((bid.price - priceRange.min) / (priceRange.max - priceRange.min) * 40) - 20; // Price axis (X)
          const yHeight = (bid.quantity / maxQuantity) * 15; // Quantity axis (Y)
          
          const geometry = new THREE.BoxGeometry(0.8, yHeight, 0.8);
          const material = new THREE.MeshLambertMaterial({ 
            color: new THREE.Color().setHSL(0.33, 0.8, 0.5 + (bid.quantity / maxQuantity) * 0.3),
            transparent: true,
            opacity: 0.8
          });
          const mesh = new THREE.Mesh(geometry, material);
          
          mesh.position.set(xPosition, yHeight / 2, zPosition);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData = { 
            isOrderbookBar: true, 
            type: 'bid',
            price: bid.price,
            quantity: bid.quantity,
            timestamp: snapshot.timestamp
          };
          scene.add(mesh);
        });
        
        // Create ask bars (red)
        snapshot.asks.slice(0, 20).forEach((ask, priceIndex) => {
          const xPosition = ((ask.price - priceRange.min) / (priceRange.max - priceRange.min) * 40) - 20; // Price axis (X)
          const yHeight = (ask.quantity / maxQuantity) * 15; // Quantity axis (Y)
          
          const geometry = new THREE.BoxGeometry(0.8, yHeight, 0.8);
          const material = new THREE.MeshLambertMaterial({ 
            color: new THREE.Color().setHSL(0, 0.8, 0.5 + (ask.quantity / maxQuantity) * 0.3),
            transparent: true,
            opacity: 0.8
          });
          const mesh = new THREE.Mesh(geometry, material);
          
          mesh.position.set(xPosition, yHeight / 2, zPosition);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData = { 
            isOrderbookBar: true, 
            type: 'ask',
            price: ask.price,
            quantity: ask.quantity,
            timestamp: snapshot.timestamp
          };
          scene.add(mesh);
        });
      });
      
      // Add pressure zones if enabled
      if (showPressureZones && orderbook.bids.length > 0 && orderbook.asks.length > 0) {
        const avgQuantity = (
          [...orderbook.bids, ...orderbook.asks].reduce((sum, level) => sum + level.quantity, 0) /
          (orderbook.bids.length + orderbook.asks.length)
        );
        
        const highVolumeThreshold = avgQuantity * 2;
        
        [...orderbook.bids, ...orderbook.asks].forEach(level => {
          if (level.quantity > highVolumeThreshold) {
            const xPosition = ((level.price - priceRange.min) / (priceRange.max - priceRange.min) * 40) - 20;
            const yPosition = (level.quantity / maxQuantity) * 15;
            
            const geometry = new THREE.SphereGeometry(2, 16, 16);
            const material = new THREE.MeshLambertMaterial({
              color: orderbook.bids.includes(level) ? 0x00ff88 : 0xff4444,
              transparent: true,
              opacity: 0.3,
              wireframe: true
            });
            const sphere = new THREE.Mesh(geometry, material);
            
            sphere.position.set(xPosition, yPosition + 2, -10);
            sphere.userData = { isOrderbookBar: true, type: 'pressure' };
            scene.add(sphere);
          }
        });
      }
    };

    updateVisualization();
  }, [orderbook, historicalData, showPressureZones]);

  return <div ref={mountRef} className="w-full h-full" />;
};

// Main Component
const OrderbookDepthVisualizer: React.FC = () => {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [isRotating, setIsRotating] = useState(true);
  const [showPressureZones, setShowPressureZones] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [timeRange, setTimeRange] = useState('1m');
  const [showFilters, setShowFilters] = useState(false);
  const [quantityThreshold, setQuantityThreshold] = useState(0.1);

  const [venues, setVenues] = useState<Venue[]>([
    { id: 'binance', name: 'Binance', color: '#f0b90b', enabled: true },
    { id: 'okx', name: 'OKX', color: '#00d4aa', enabled: false },
    { id: 'bybit', name: 'Bybit', color: '#f7a600', enabled: false },
    { id: 'deribit', name: 'Deribit', color: '#1e3a8a', enabled: false },
  ]);

  const { orderbook, historicalData, connected, error } = useOrderbookWebSocket(symbol);

  const toggleVenue = (venueId: string) => {
    setVenues(prev => prev.map(venue => 
      venue.id === venueId ? { ...venue, enabled: !venue.enabled } : venue
    ));
  };

  const resetView = () => {
    setIsRotating(true);
    setQuantityThreshold(0.1);
  };

  const spread = useMemo(() => {
    if (orderbook.bids.length === 0 || orderbook.asks.length === 0) return 0;
    const bestBid = Math.max(...orderbook.bids.map(b => b.price));
    const bestAsk = Math.min(...orderbook.asks.map(a => a.price));
    return bestAsk - bestBid;
  }, [orderbook]);

  const totalVolume = useMemo(() => {
    const bidVolume = orderbook.bids.reduce((sum, bid) => sum + bid.quantity, 0);
    const askVolume = orderbook.asks.reduce((sum, ask) => sum + ask.quantity, 0);
    return { bids: bidVolume, asks: askVolume };
  }, [orderbook]);

  return (
    <div className={`w-full h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold">3D Orderbook Depth Visualizer</h1>
          <div className={`px-3 py-1 rounded-full text-sm ${connected ? 'bg-green-500' : 'bg-red-500'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </div>
          {error && <div className="text-red-400 text-sm">{error}</div>}
        </div>
        
        <div className="flex items-center space-x-2">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded px-3 py-1"
          >
            <option value="BTCUSDT">BTC/USDT</option>
            <option value="ETHUSDT">ETH/USDT</option>
            <option value="ADAUSDT">ADA/USDT</option>
            <option value="DOTUSDT">DOT/USDT</option>
          </select>
          
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            {darkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </div>

      <div className="flex h-full">
        {/* Controls Panel */}
        <div className="w-80 bg-gray-800 p-4 space-y-4 overflow-y-auto">
          <div>
            <h3 className="text-lg font-semibold mb-2">Controls</h3>
            <div className="space-y-2">
              <button
                onClick={() => setIsRotating(!isRotating)}
                className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded transition-colors"
              >
                {isRotating ? <Pause size={16} /> : <Play size={16} />}
                <span>{isRotating ? 'Pause' : 'Play'} Rotation</span>
              </button>
              
              <button
                onClick={resetView}
                className="w-full flex items-center justify-center space-x-2 bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded transition-colors"
              >
                <RotateCcw size={16} />
                <span>Reset View</span>
              </button>
              
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="w-full flex items-center justify-center space-x-2 bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded transition-colors"
              >
                <Filter size={16} />
                <span>Filters</span>
              </button>
            </div>
          </div>

          {/* Market Stats */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Market Stats</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Spread:</span>
                <span className="text-yellow-400">${spread.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Bid Volume:</span>
                <span className="text-green-400">{totalVolume.bids.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Ask Volume:</span>
                <span className="text-red-400">{totalVolume.asks.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Best Bid:</span>
                <span className="text-green-400">
                  ${orderbook.bids.length > 0 ? Math.max(...orderbook.bids.map(b => b.price)).toFixed(2) : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Best Ask:</span>
                <span className="text-red-400">
                  ${orderbook.asks.length > 0 ? Math.min(...orderbook.asks.map(a => a.price)).toFixed(2) : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Data Points:</span>
                <span className="text-blue-400">{historicalData.length}</span>
              </div>
            </div>
          </div>

          {/* Venues */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Trading Venues</h3>
            <div className="space-y-2">
              {venues.map(venue => (
                <label key={venue.id} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={venue.enabled}
                    onChange={() => toggleVenue(venue.id)}
                    className="rounded"
                  />
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: venue.color }}
                  />
                  <span>{venue.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Visualization Options */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Visualization</h3>
            <div className="space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPressureZones}
                  onChange={(e) => setShowPressureZones(e.target.checked)}
                  className="rounded"
                />
                <span>Show Pressure Zones</span>
              </label>
            </div>
          </div>

          {/* Time Range */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Time Range</h3>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
            >
              <option value="1m">1 Minute</option>
              <option value="5m">5 Minutes</option>
              <option value="15m">15 Minutes</option>
              <option value="1h">1 Hour</option>
            </select>
          </div>

          {showFilters && (
            <div>
              <h3 className="text-lg font-semibold mb-2">Filters</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm mb-1">Min Quantity</label>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.1"
                    value={quantityThreshold}
                    onChange={(e) => setQuantityThreshold(parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <span className="text-xs text-gray-400">{quantityThreshold}</span>
                </div>
              </div>
            </div>
          )}

          {/* Legend */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Legend</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-green-500 rounded"></div>
                <span>Bid Orders</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-red-500 rounded"></div>
                <span>Ask Orders</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-yellow-400 rounded-full opacity-30"></div>
                <span>Pressure Zones</span>
              </div>
            </div>
          </div>

          {/* Axis Information */}
          <div>
            <h3 className="text-lg font-semibold mb-2">3D Axes</h3>
            <div className="space-y-1 text-sm">
              <div className="flex items-center space-x-2">
                <span className="text-red-400">X-Axis:</span>
                <span>Price Level</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-green-400">Y-Axis:</span>
                <span>Order Quantity</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-blue-400">Z-Axis:</span>
                <span>Time Progression</span>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="text-xs text-gray-400 space-y-1">
            <p><strong>Mouse Controls:</strong></p>
            <p>• Click + Drag: Rotate view</p>
            <p>• Scroll: Zoom in/out</p>
            <p>• Auto-rotation can be toggled</p>
            <p><strong>Visualization:</strong></p>
            <p>• Green bars: Bid orders</p>
            <p>• Red bars: Ask orders</p>
            <p>• Bar height: Order quantity</p>
            <p>• Bar position: Price & time</p>
          </div>
        </div>

        {/* 3D Visualization */}
        <div className="flex-1 relative">
          <ThreeJSVisualization
            orderbook={orderbook}
            historicalData={historicalData}
            isRotating={isRotating}
            showPressureZones={showPressureZones}
            darkMode={darkMode}
          />
          
          {/* Loading overlay */}
          {!connected && (
            <div className="absolute inset0 flex itemcenter justify-center bg-black bg-opacity-75">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <p className="text-white">Connecting to market data...</p>
              </div>
            </div>
          )}
          
          {/* Info overlay */}
          <div className="absolute top-4 right-4 bg-black bg-opacity-50 text-white p-4 rounded-lg">
            <div className="text-sm space-y-1">
              <div>Symbol: <span className="font-bold text-yellow-400">{symbol}</span></div>
              <div>Updates: <span className="font-bold text-green-400">{historicalData.length}</span></div>
              <div>Status: <span className={`font-bold ${connected ? 'text-green-400' : 'text-red-400'}`}>
                {connected ? 'Live' : 'Disconnected'}
              </span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderbookDepthVisualizer;