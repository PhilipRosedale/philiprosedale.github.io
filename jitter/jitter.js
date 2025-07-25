class JitterExplorer {
    constructor() {
        this.canvas = document.getElementById('animationCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.fpsDisplay = document.getElementById('fpsValue');
        this.frameDisplay = document.getElementById('frameValue');
        this.jitterDisplay = document.getElementById('jitterValue');
        this.nftvDisplay = document.getElementById('nftvValue');
        
        // Animation properties
        this.isRunning = true; // Start animation by default
        this.frameCount = 0;
        this.lastTime = 0;
        this.fps = 0;
        this.fpsUpdateInterval = 0;
        
        // Performance tracking
        this.frameTimes = [];
        this.avgFrameTime = 0;
        
        // Time-based animation properties
        this.startTime = 0;
        this.angularVelocity = 2.0; // radians per second (default)
        this.fpsDivide = 1; // FPS divide factor for frame skipping (default to 1)
        
        // Jitter tracking properties
        this.rotationFrameTimes = []; // Frame times for current rotation
        this.rotationStartTime = 0; // Start time of current rotation
        this.normalizedJitter = 0; // Current normalized jitter value
        this.delayAccumulatedTime = 0; // Accumulated delay time to add to next frame
        this.frameSkipCounter = 0; // Counter for frame skipping
        
        // Dot properties
        this.dotRadius = 20; // 40px diameter
        this.orbitRadius = 200;
        this.centerX = this.canvas.width / 2;
        this.centerY = this.canvas.height / 2;
        this.angle = 0;
        
        // Jitter control properties
        this.jitterEvents = [];
        this.currentDelay = 0;
        this.delayStartFrame = 0;
        this.isInDelay = false;
        this.showDelay = false; // Track checkbox state
        this.delayStartX = 0; // Store the exact position where delay started
        this.delayStartY = 0;
        this.delayStartTime = 0; // Store the actual time when delay started
        
        this.initializeControls();
        this.setupEventListeners();
        this.startTime = performance.now(); // Set start time immediately since animation starts by default
        this.animate();
    }
    
    initializeControls() {
        this.addRowBtn = document.getElementById('addRowBtn');
        this.clearAllBtn = document.getElementById('clearAllBtn');
        this.startStopBtn = document.getElementById('startStopBtn');
        this.frameDelayRows = document.getElementById('frameDelayRows');
        this.angularVelocityInput = document.getElementById('angularVelocityInput');
        this.showDelayCheckbox = document.getElementById('showDelayCheckbox');
        this.fpsDivideInput = document.getElementById('fpsDivideInput');
        
        // Set button to "Stop" since animation starts by default
        this.startStopBtn.textContent = 'Stop';
        this.startStopBtn.classList.add('running');
        
        // Add initial rows
        this.addRow();
        this.addRow();
    }
    
    setupEventListeners() {
        this.addRowBtn.addEventListener('click', () => this.addRow());
        this.clearAllBtn.addEventListener('click', () => this.clearAll());
        this.startStopBtn.addEventListener('click', () => this.toggleAnimation());
        this.angularVelocityInput.addEventListener('input', () => {
            this.angularVelocity = parseFloat(this.angularVelocityInput.value) || 1.0;
        });
        this.showDelayCheckbox.addEventListener('change', () => {
            this.showDelay = this.showDelayCheckbox.checked;
        });
        this.fpsDivideInput.addEventListener('input', () => {
            this.fpsDivide = parseInt(this.fpsDivideInput.value) || 0;
            this.frameSkipCounter = 0; // Reset counter when setting changes
        });
    }
    
    addRow() {
        const row = document.createElement('div');
        row.className = 'frame-delay-row';
        
        const frameInput = document.createElement('input');
        frameInput.type = 'number';
        frameInput.placeholder = 'Frame #';
        frameInput.min = '0';
        
        const delayInput = document.createElement('input');
        delayInput.type = 'number';
        delayInput.placeholder = 'Delay';
        delayInput.min = '0';
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-row-btn';
        removeBtn.innerHTML = '×';
        removeBtn.addEventListener('click', () => {
            row.remove();
            this.updateJitterEvents();
        });
        
        row.appendChild(frameInput);
        row.appendChild(delayInput);
        row.appendChild(removeBtn);
        
        this.frameDelayRows.appendChild(row);
        
        // Add event listeners for inputs
        frameInput.addEventListener('input', () => this.updateJitterEvents());
        delayInput.addEventListener('input', () => this.updateJitterEvents());
        
        this.updateJitterEvents();
    }
    
    clearAll() {
        this.frameDelayRows.innerHTML = '';
        this.jitterEvents = [];
    }
    
    updateJitterEvents() {
        this.jitterEvents = [];
        const rows = this.frameDelayRows.querySelectorAll('.frame-delay-row');
        
        rows.forEach(row => {
            const inputs = row.querySelectorAll('input');
            const frameNum = parseInt(inputs[0].value);
            const delay = parseInt(inputs[1].value);
            
            if (!isNaN(frameNum) && !isNaN(delay) && frameNum >= 0 && delay >= 0) {
                this.jitterEvents.push({
                    frame: frameNum,
                    delay: delay
                });
            }
        });
        
        // Sort by frame number
        this.jitterEvents.sort((a, b) => a.frame - b.frame);
    }
    
    toggleAnimation() {
        this.isRunning = !this.isRunning;
        
        if (this.isRunning) {
            this.startTime = performance.now();
            this.startStopBtn.textContent = 'Stop';
            this.startStopBtn.classList.add('running');
        } else {
            this.startStopBtn.textContent = 'Start';
            this.startStopBtn.classList.remove('running');
        }
    }
    
    checkJitterEvents() {
        if (this.isInDelay) {
            if (this.frameCount - this.delayStartFrame >= this.currentDelay) {
                this.isInDelay = false;
                this.currentDelay = 0;
                // Add the actual measured delay time to the accumulated delay time
                const currentTime = performance.now();
                const actualDelayTime = currentTime - this.delayStartTime;
                this.delayAccumulatedTime += actualDelayTime;
            }
            return;
        }
        
        for (let event of this.jitterEvents) {
            if (this.frameCount === event.frame) {
                this.isInDelay = true;
                this.delayStartFrame = this.frameCount;
                this.currentDelay = event.delay;
                this.delayStartTime = performance.now(); // Store the actual time when delay started
                // Store the exact position where the delay started
                this.delayStartX = this.centerX + this.orbitRadius * Math.cos(this.angle);
                this.delayStartY = this.centerY + this.orbitRadius * Math.sin(this.angle);
                break;
            }
        }
    }
    
    updateFPS(currentTime) {
        if (this.lastTime !== 0) {
            const deltaTime = currentTime - this.lastTime;
            this.fps = 1000 / deltaTime;
            
            // Track frame times for performance analysis
            this.frameTimes.push(deltaTime);
            if (this.frameTimes.length > 60) { // Keep last 60 frames
                this.frameTimes.shift();
            }
            
            // Calculate average frame time
            this.avgFrameTime = this.frameTimes.reduce((sum, time) => sum + time, 0) / this.frameTimes.length;
        }
        this.lastTime = currentTime;
        
        // Update frame display every frame
        this.frameDisplay.textContent = this.frameCount;
    }
    
    calculateNormalizedJitter() {
        if (this.rotationFrameTimes.length < 2) {
            return 0;
        }
        
        // Calculate sum of absolute differences between consecutive frame times
        let sumDifferences = 0;
        for (let i = 1; i < this.rotationFrameTimes.length; i++) {
            sumDifferences += Math.abs(this.rotationFrameTimes[i] - this.rotationFrameTimes[i-1]);
        }
        
        // Calculate total elapsed time for the rotation
        const totalElapsedTime = this.rotationFrameTimes.reduce((sum, time) => sum + time, 0);
        
        // Return normalized jitter (sum of differences / total time)
        return totalElapsedTime > 0 ? sumDifferences / totalElapsedTime : 0;
    }
    
    calculateNFTV() {
        if (this.rotationFrameTimes.length < 2) {
            return 0;
        }
        
        // Calculate mean frame time
        const mean = this.rotationFrameTimes.reduce((sum, time) => sum + time, 0) / this.rotationFrameTimes.length;
        
        // Calculate variance (mean squared difference from mean)
        const variance = this.rotationFrameTimes.reduce((sum, time) => {
            const diff = time - mean;
            return sum + (diff * diff);
        }, 0) / this.rotationFrameTimes.length;
        
        // Calculate standard deviation
        const stdDev = Math.sqrt(variance);
        
        // Return normalized frame time variance (std dev / mean)
        return mean > 0 ? stdDev / mean : 0;
    }
    
    drawDot() {
        // Clear only the area we need (optimization)
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Calculate dot position
        let x, y;
        
        if (this.isInDelay) {
            // Use the stored position where the delay started
            x = this.delayStartX;
            y = this.delayStartY;
        } else {
            // Normal rotation based on time
            x = this.centerX + this.orbitRadius * Math.cos(this.angle);
            y = this.centerY + this.orbitRadius * Math.sin(this.angle);
        }
        
        // Determine dot color based on delay state and checkbox
        let dotColor = 'white';
        if (this.isInDelay && this.showDelay) {
            dotColor = '#ff4757'; // Red color when delayed and checkbox is checked
        }
        
        // Draw the dot (optimized rendering)
        this.ctx.beginPath();
        this.ctx.arc(x, y, this.dotRadius, 0, 2 * Math.PI);
        this.ctx.fillStyle = dotColor;
        this.ctx.fill();
    }
    
    animate(currentTime = 0) {
        if (this.isRunning) {
            // Handle frame skipping for FPS divide
            if (this.fpsDivide > 0) {
                this.frameSkipCounter++;
                if (this.frameSkipCounter < this.fpsDivide) {
                    // Skip this frame, request next frame
                    requestAnimationFrame((time) => this.animate(time));
                    return;
                }
                this.frameSkipCounter = 0; // Reset counter after skipping
            }
            
            this.checkJitterEvents();
            
            if (!this.isInDelay) {
                // Calculate angle based on elapsed time and angular velocity
                const elapsedTime = (currentTime - this.startTime) / 1000; // Convert to seconds
                this.angle = this.angularVelocity * elapsedTime;
                
                // Reset frame counter when angle completes a full rotation (2π)
                if (this.angle >= 2 * Math.PI) {
                    // Calculate normalized jitter for the completed rotation
                    this.normalizedJitter = this.calculateNormalizedJitter();
                    this.jitterDisplay.textContent = this.normalizedJitter.toFixed(3);
                    
                    // Calculate NFTV for the completed rotation
                    const nftv = this.calculateNFTV();
                    this.nftvDisplay.textContent = nftv.toFixed(3);
                    
                    // Update FPS display every full rotation
                    this.fpsDisplay.textContent = Math.round(this.fps);
                    
                    // Reset for next rotation
                    this.angle = 0;
                    this.frameCount = 0;
                    this.startTime = currentTime; // Reset start time for next rotation
                    this.rotationFrameTimes = []; // Clear frame times for new rotation
                    this.rotationStartTime = currentTime;
                }
                
                // Track frame time for current rotation (only when not in delay)
                if (this.lastTime !== 0) {
                    let frameTime = currentTime - this.lastTime;
                    
                    // Add accumulated delay time to the first frame after a delay
                    if (this.delayAccumulatedTime > 0) {
                        frameTime += this.delayAccumulatedTime;
                        this.delayAccumulatedTime = 0; // Reset accumulated time
                    }
                    
                    this.rotationFrameTimes.push(frameTime);
                }
            }
            
            this.drawDot();
            this.frameCount++;
        }
        
        this.updateFPS(currentTime);
        
        // Request next frame immediately
        requestAnimationFrame((time) => this.animate(time));
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new JitterExplorer();
}); 