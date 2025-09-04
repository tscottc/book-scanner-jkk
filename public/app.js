// public/app.js (Final Version with zxing-js)

document.addEventListener("DOMContentLoaded", () => {
    // DOM Element selections
    const videoElement = document.getElementById("scanner-video");
    const startButton = document.getElementById("startButton");
    const stopButton = document.getElementById("stopButton");
    const torchButton = document.getElementById("torchButton");
    const searchInput = document.getElementById("searchInput");
    const searchButton = document.getElementById("searchButton");
    const switchCameraButton = document.getElementById("switchCameraButton");
    const laserBeam = document.querySelector(".laser-beam");
    const scannerTarget = document.querySelector(".scanner-target");
    const scanningFeedback = document.querySelector(".scanning-feedback");
    const resultsContainer = document.getElementById("results-container");

    // State variables
    let codeReader = null;
    let videoStream = null;
    let isProcessing = false;
    let isTorchOn = false;
    let resultsList = [];
    let currentSearchResults = [];
    let currentCameraIndex = 0;
    let availableCameras = [];

    // --- IMPORTANT: FILL THESE IN ---
    const FIREBASE_PROJECT_ID = "book-scanner-jkk";
    const GOOGLE_BOOKS_API_KEY = "AIzaSyC1Zh1VMGsnKCui1agTkQA8yo7VZif4Jss";
    
    const CLOUD_FUNCTION_URL = `https://us-central1-${FIREBASE_PROJECT_ID}.cloudfunctions.net/getBookTopic`;

    // --- TORCH/FLASHLIGHT FUNCTION ---
    async function toggleTorch() {
        if (!videoStream) return;

        const track = videoStream.getVideoTracks()[0];
        const capabilities = track.getCapabilities();

        if (!capabilities.torch) {
            alert("Flashlight is not available on this device.");
            torchButton.disabled = true;
            return;
        }

        try {
            await track.applyConstraints({
                advanced: [{ torch: !isTorchOn }]
            });
            isTorchOn = !isTorchOn;
        } catch (err) {
            console.error("Error applying torch constraint:", err);
        }
    }

    // --- IMPROVED CAMERA SELECTION ---
    async function getAvailableCameras() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            availableCameras = videoDevices;
            console.log("Available cameras:", videoDevices.map(d => ({ label: d.label, deviceId: d.deviceId })));
            return videoDevices;
        } catch (error) {
            console.error("Error getting cameras:", error);
            return [];
        }
    }

    async function selectBestCamera() {
        const videoDevices = await getAvailableCameras();
        
        if (videoDevices.length === 0) {
            console.error("No cameras available");
            return null;
        }
        
        // If only one camera, use it
        if (videoDevices.length === 1) {
            console.log(`Only one camera available: ${videoDevices[0].label}`);
            currentCameraIndex = 0;
            return videoDevices[0].deviceId;
        }
        
        // Check if this is an iOS device
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
        console.log(`Device type: ${isIOS ? 'iOS' : 'Other'}, Browser: ${isSafari ? 'Safari' : 'Other'}`);
        
        // For iOS Safari, try a different approach - often the second camera is the back camera
        if (isIOS && videoDevices.length > 1) {
            console.log(`iOS device detected, trying second camera first`);
            currentCameraIndex = 1;
            return videoDevices[1].deviceId;
        }
        
        // Priority order: back camera, rear camera, environment camera, then any other
        const backCameraKeywords = ['back', 'rear', 'environment', 'external', 'main', 'primary'];
        const frontCameraKeywords = ['front', 'user', 'selfie', 'self'];
        
        // First, try to find a back camera
        for (const keyword of backCameraKeywords) {
            const backCamera = videoDevices.find(device => 
                device.label.toLowerCase().includes(keyword)
            );
            if (backCamera) {
                const index = videoDevices.indexOf(backCamera);
                console.log(`Selected back camera: ${backCamera.label} (index: ${index})`);
                currentCameraIndex = index;
                return backCamera.deviceId;
            }
        }
        
        // If no back camera found, avoid front cameras if possible
        const nonFrontCamera = videoDevices.find(device => 
            !frontCameraKeywords.some(keyword => device.label.toLowerCase().includes(keyword))
        );
        
        if (nonFrontCamera) {
            const index = videoDevices.indexOf(nonFrontCamera);
            console.log(`Selected non-front camera: ${nonFrontCamera.label} (index: ${index})`);
            currentCameraIndex = index;
            return nonFrontCamera.deviceId;
        }
        
        // If multiple cameras but can't determine which is back, try the second camera
        // (often the second camera is the back camera)
        if (videoDevices.length > 1) {
            console.log(`Trying second camera: ${videoDevices[1].label}`);
            currentCameraIndex = 1;
            return videoDevices[1].deviceId;
        }
        
        // Fallback to first available camera
        console.log(`Using fallback camera: ${videoDevices[0].label}`);
        currentCameraIndex = 0;
        return videoDevices[0].deviceId;
    }

    async function switchCamera() {
        if (availableCameras.length <= 1) {
            alert("Only one camera available");
            return;
        }
        
        // Stop current scanner
        if (videoStream) {
            stopScanner();
        }
        
        // Switch to next camera
        currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
        const selectedCamera = availableCameras[currentCameraIndex];
        console.log(`Switched to camera: ${selectedCamera.label} (index: ${currentCameraIndex})`);
        
        // Show feedback
        scanningFeedback.textContent = `Switching to camera ${currentCameraIndex + 1}...`;
        scanningFeedback.style.display = "block";
        
        // Small delay to ensure camera is released
        setTimeout(async () => {
            try {
                await startScanner();
            } catch (error) {
                console.error("Error switching camera:", error);
                alert("Failed to switch camera. Please try again.");
            }
        }, 500);
    }

    // --- IMPROVED SCANNER FUNCTIONS ---
    async function startScanner() {
        isProcessing = false;
        try {
            // Show loading state
            startButton.disabled = true;
            startButton.textContent = "Starting...";
            
            const hints = new Map();
            const formats = [
                ZXing.BarcodeFormat.EAN_13, 
                ZXing.BarcodeFormat.UPC_A,
                ZXing.BarcodeFormat.EAN_8,
                ZXing.BarcodeFormat.UPC_E
            ];
            hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
            hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
            hints.set(ZXing.DecodeHintType.PURE_BARCODE, true);
            
            codeReader = new ZXing.BrowserMultiFormatReader(hints);
            
            // Select the best camera
            const selectedDeviceId = await selectBestCamera();
            if (!selectedDeviceId) {
                throw new Error("No suitable camera found");
            }

            laserBeam.style.display = "block";
            scannerTarget.style.display = "block";
            scanningFeedback.style.display = "block";

            // Improved video constraints for better scanning
            const constraints = {
                video: {
                    deviceId: { exact: selectedDeviceId },
                    width: { min: 640, ideal: 1280, max: 1920 },
                    height: { min: 480, ideal: 720, max: 1080 },
                    focusMode: { ideal: "continuous" },
                    exposureMode: { ideal: "continuous" },
                    whiteBalanceMode: { ideal: "continuous" }
                }
            };
            
            // Get the stream first to enable torch control
            videoStream = await navigator.mediaDevices.getUserMedia(constraints);
            const track = videoStream.getVideoTracks()[0];
            torchButton.disabled = !track.getCapabilities().torch;

            // Start decoding with improved error handling
            codeReader.decodeFromStream(videoStream, videoElement, (result, err) => {
                if (result && !isProcessing) {
                    console.log("Barcode detected:", result.getText());
                    scanningFeedback.textContent = "Barcode detected!";
                    scanningFeedback.style.background = "rgba(40, 167, 69, 0.9)";
                    isProcessing = true;
                    setTimeout(() => {
                        stopScanner();
                        handleISBN(result.getText());
                    }, 500); // Small delay to show success feedback
                }
                if (err && !(err instanceof ZXing.NotFoundException)) {
                    console.error("Scanning error:", err);
                }
            });
            
            // Reset button state
            startButton.disabled = false;
            startButton.textContent = "Start";
            
        } catch (err) {
            console.error("Error starting scanner:", err);
            
            // Better error messages for different scenarios
            let errorMessage = "Could not start scanner. ";
            if (err.name === 'NotAllowedError') {
                errorMessage += "Please grant camera permissions and try again.";
            } else if (err.name === 'NotFoundError') {
                errorMessage += "No camera detected. Please ensure you have a camera and try again.";
            } else if (err.name === 'NotSupportedError') {
                errorMessage += "Camera not supported on this device/browser.";
            } else {
                errorMessage += "Please ensure you have a camera and have granted permissions.";
            }
            
            alert(errorMessage);
            startButton.disabled = false;
            startButton.textContent = "Start";
        }
    }

    function stopScanner() {
        if (isTorchOn) {
            toggleTorch();
        }
        torchButton.disabled = true;
        if (codeReader) codeReader.reset();
        if (videoStream) videoStream.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
        laserBeam.style.display = "none";
        scannerTarget.style.display = "none";
        scanningFeedback.style.display = "none";
    }
    
    // --- MANUAL SEARCH FUNCTIONS ---
    async function manualSearch() {
        const query = searchInput.value.trim();
        if (!query) return;

        if (/^\d{10}(\d{3})?$/.test(query)) {
            handleISBN(query);
            return;
        }

        try {
            const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&key=${GOOGLE_BOOKS_API_KEY}`);
            const data = await response.json();
            
            if (data.totalItems === 0) {
                alert("No books found for that search.");
                return;
            }

            if (data.totalItems === 1) {
                const bookData = parseGoogleBook(data.items[0]);
                handleBookData(bookData);
            } else {
                currentSearchResults = data.items.map(parseGoogleBook).filter(book => book);
                displaySearchResults(currentSearchResults);
            }
        } catch (error) {
            console.error("Error during manual search:", error);
            alert("An error occurred during the search.");
        }
    }

    function displaySearchResults(books) {
        resultsContainer.innerHTML = "";
        const container = document.createElement("div");
        container.className = "search-results-container";
        
        const title = document.createElement("h4");
        title.textContent = "Which book did you mean?";
        container.appendChild(title);

        books.slice(0, 10).forEach((book, index) => {
            const item = document.createElement("div");
            item.className = "search-result-item";
            item.innerHTML = `<h5>${book.title}</h5><p>${book.author}</p>`;
            item.addEventListener("click", () => selectBook(index));
            container.appendChild(item);
        });
        resultsContainer.prepend(container);
    }
    
    function selectBook(index) {
        const selectedBook = currentSearchResults[index];
        resultsContainer.innerHTML = "";
        resultsList.forEach(book => displayResult(book, book.aiTopic));
        handleBookData(selectedBook);
    }
    
    // --- DATA HANDLING AND DISPLAY ---
    function parseGoogleBook(item) {
        if (!item || !item.volumeInfo) return null;
        const vi = item.volumeInfo;
        return {
            title: vi.title || "N/A",
            author: vi.authors ? vi.authors.join(", ") : "Unknown Author",
            description: vi.description || "No description available.",
            category: vi.categories ? vi.categories[0] : "Unknown",
        };
    }
    
    async function handleISBN(isbn) {
        try {
            const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${GOOGLE_BOOKS_API_KEY}`);
            const data = await response.json();
            if (data.totalItems > 0) {
                const bookData = parseGoogleBook(data.items[0]);
                handleBookData(bookData);
            } else {
                alert(`Could not find book data for ISBN: ${isbn}`);
            }
        } catch(error) {
            console.error("Error fetching ISBN:", error);
        }
    }

    async function handleBookData(bookData) {
        // Display the book first with "Analyzing..." placeholder
        displayResult(bookData, "Analyzing...");
        
        let aiTopic = "AI analysis failed.";
        try {
            console.log("Calling AI function with:", { title: bookData.title, description: bookData.description });
            
            const aiResponse = await fetch(CLOUD_FUNCTION_URL, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    title: bookData.title,
                    description: bookData.description
                })
            });
            
            console.log("AI response status:", aiResponse.status);
            console.log("AI response headers:", aiResponse.headers);
            
            if (!aiResponse.ok) {
                const errorText = await aiResponse.text();
                console.error("AI function error response:", errorText);
                throw new Error(`AI function failed with status ${aiResponse.status}: ${errorText}`);
            }
            
            const aiData = await aiResponse.json();
            console.log("AI response data:", aiData);
            aiTopic = aiData.topic;
        } catch (error) {
            console.error("Error calling AI function:", error);
            aiTopic = `AI analysis failed: ${error.message}`;
        }
        
        // Store the AI topic with the book data
        bookData.aiTopic = aiTopic;
        
        // Update the display with the AI topic
        const latestResult = resultsContainer.querySelector('.book-result');
        if (latestResult) {
            const aiTopicElement = latestResult.querySelector('.ai-topic-p');
            if (aiTopicElement) {
                aiTopicElement.innerHTML = `<strong>AI Topic:</strong> ${aiTopic}`;
            }
        }
    }

    function displayResult(data, aiTopic = "Analyzing...") {
        if (!resultsList.find(book => book.title === data.title && book.author === data.author)) {
            resultsList.unshift(data);
            if (resultsList.length > 8) resultsList.pop();
        }
        
        const placeholder = document.querySelector(".book-result");
        if (placeholder && resultsList.length === 1) resultsContainer.innerHTML = "";

        const resultElement = document.createElement("div");
        resultElement.className = "book-result";
        resultElement.innerHTML = `
            <div class="prioritized-info">
                <p><strong>Category:</strong> ${data.category}</p>
                <p class="ai-topic-p"><strong>AI Topic:</strong> ${aiTopic}</p>
            </div>
            <div class="book-details">
                <h4>${data.title}</h4>
                <p class="description">${data.description}</p>
            </div>
        `;
        resultsContainer.prepend(resultElement);
    }

    // --- EVENT LISTENERS ---
    startButton.addEventListener("click", startScanner);
    stopButton.addEventListener("click", stopScanner);
    torchButton.addEventListener("click", toggleTorch);
    switchCameraButton.addEventListener("click", switchCamera);
    searchButton.addEventListener("click", manualSearch);
    searchInput.addEventListener("keyup", (event) => {
        if (event.key === "Enter") {
            manualSearch();
        }
    });
});