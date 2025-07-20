# Jitter Explorer

A web-based tool for exploring perceptual thresholds of jitter detection in animated displays.

## Features

- **Smooth Animation**: A 40-pixel diameter white dot rotates smoothly in a circular orbit
- **Real-time FPS Display**: Shows the current animation frame rate
- **Jitter Control**: Add frame-specific delays to create controlled jitter events
- **Interactive Interface**: Easy-to-use controls for testing different jitter parameters

## How to Use

1. **Start the Animation**: Click the "Start" button to begin the rotating dot animation
2. **Add Jitter Events**: Use the "Add Row" button to create new frame/delay entries
3. **Configure Jitter**: 
   - Enter a frame number when you want the jitter to occur
   - Enter the number of frames to delay (pause) the animation
4. **Test Different Values**: Experiment with different frame numbers and delay values to find your perceptual threshold

## Understanding the Results

- **Frame Number**: The animation frame when the jitter event occurs
- **Delay**: How many frames the dot stays in the same position before resuming
- **Perceptual Threshold**: The minimum delay value where you can detect the jitter

## Technical Details

- The dot rotates at approximately 60 FPS (depending on your display)
- The orbit radius is 200 pixels
- The dot has a subtle glow effect for better visibility
- FPS is measured and displayed in real-time

## Getting Started

1. Open `index.html` in a modern web browser
2. Click "Start" to begin the animation
3. Add jitter events using the controls on the right
4. Observe when you can detect the jitter vs. when it appears smooth

## Browser Compatibility

This tool works best in modern browsers that support:
- HTML5 Canvas
- CSS Grid and Flexbox
- ES6 JavaScript classes

## Files

- `index.html` - Main HTML structure
- `styles.css` - Styling and layout
- `script.js` - Animation and interaction logic
- `README.md` - This documentation 