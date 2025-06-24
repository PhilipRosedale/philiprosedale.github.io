// Digital File Signer - Philip Rosedale
// Handles file upload, hashing, signing, and verification

class DigitalSigner {
    constructor() {
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        // File upload elements
        this.fileInput = document.getElementById('fileInput');
        this.fileInfo = document.getElementById('fileInfo');
        this.privateKeyInput = document.getElementById('privateKey');
        this.signButton = document.getElementById('signButton');
        
        // Results elements
        this.results = document.getElementById('results');
        this.fileHash = document.getElementById('fileHash');
        this.signature = document.getElementById('signature');
        this.publicKey = document.getElementById('publicKey');
        this.copyResults = document.getElementById('copyResults');
        this.downloadResults = document.getElementById('downloadResults');
        
        // Verification elements
        this.verifyFile = document.getElementById('verifyFile');
        this.verifySignature = document.getElementById('verifySignature');
        this.verifyPublicKey = document.getElementById('verifyPublicKey');
        this.verifyButton = document.getElementById('verifyButton');
        this.verificationResult = document.getElementById('verificationResult');
        this.resultStatus = document.getElementById('resultStatus');
    }

    bindEvents() {
        // File upload events
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.privateKeyInput.addEventListener('input', () => this.updateSignButton());
        this.signButton.addEventListener('click', () => this.signFile());
        
        // Results events
        this.copyResults.addEventListener('click', () => this.copyResultsToClipboard());
        this.downloadResults.addEventListener('click', () => this.downloadResults());
        
        // Verification events
        console.log('Binding verify button event...');
        this.verifyButton.addEventListener('click', () => {
            console.log('Verify button clicked!');
            this.verifyFileSignature();
        });
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.fileInfo.innerHTML = `
                <div class="file-details">
                    <strong>${file.name}</strong><br>
                    Size: ${this.formatFileSize(file.size)}<br>
                    Type: ${file.type || 'Unknown'}
                </div>
            `;
            this.updateSignButton();
        } else {
            this.fileInfo.innerHTML = '';
            this.updateSignButton();
        }
    }

    updateSignButton() {
        const hasFile = this.fileInput.files.length > 0;
        const hasPrivateKey = this.privateKeyInput.value.trim().length > 0;
        this.signButton.disabled = !(hasFile && hasPrivateKey);
    }

    async signFile() {
        const file = this.fileInput.files[0];
        const privateKeyPem = this.privateKeyInput.value.trim();
        
        if (!file || !privateKeyPem) {
            this.showError('Please select a file and provide a private key.');
            return;
        }

        try {
            this.signButton.disabled = true;
            this.signButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing...';
            
            // Generate file hash
            const fileHash = await this.generateFileHash(file);
            
            // Parse private key
            const privateKey = this.parsePrivateKey(privateKeyPem);
            
            // Sign the hash
            const signature = this.signHash(fileHash, privateKey);
            
            // Extract public key
            const publicKeyPem = this.extractPublicKey(privateKey);
            
            // Display results
            this.displayResults(fileHash, signature, publicKeyPem);
            
        } catch (error) {
            console.error('Signing error:', error);
            this.showError('Error signing file: ' + error.message);
        } finally {
            this.signButton.disabled = false;
            this.signButton.innerHTML = '<i class="fas fa-signature"></i> Sign File';
        }
    }

    async generateFileHash(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer);
                    const hash = CryptoJS.SHA256(wordArray);
                    resolve(hash.toString(CryptoJS.enc.Hex));
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    parsePrivateKey(privateKeyPem) {
        try {
            // Remove headers and footers
            const keyContent = privateKeyPem
                .replace(/-----BEGIN PRIVATE KEY-----/, '')
                .replace(/-----END PRIVATE KEY-----/, '')
                .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
                .replace(/-----END RSA PRIVATE KEY-----/, '')
                .replace(/\s/g, '');
            
            // Decode base64
            const keyBytes = forge.util.decode64(keyContent);
            
            // Parse as ASN.1
            const asn1 = forge.asn1.fromDer(keyBytes);
            return forge.pki.privateKeyFromAsn1(asn1);
        } catch (error) {
            throw new Error('Invalid private key format. Please provide a valid PEM-encoded private key.');
        }
    }

    signHash(hash, privateKey) {
        try {
            // Convert hex hash to bytes using forge
            const hashBytes = forge.util.hexToBytes(hash);
            
            // Create signature using the raw hash bytes with no digest algorithm
            const signature = privateKey.sign(hashBytes, 'NONE');
            
            // Return base64 encoded signature
            return forge.util.encode64(signature);
        } catch (error) {
            throw new Error('Error creating signature: ' + error.message);
        }
    }

    extractPublicKey(privateKey) {
        try {
            // For RSA keys, we need to create a public key from the private key components
            const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
            const publicKeyPem = forge.pki.publicKeyToPem(publicKey);
            return publicKeyPem;
        } catch (error) {
            throw new Error('Error extracting public key: ' + error.message);
        }
    }

    displayResults(fileHash, signature, publicKeyPem) {
        this.fileHash.textContent = fileHash;
        this.signature.textContent = signature;
        this.publicKey.textContent = publicKeyPem;
        this.results.style.display = 'block';
        
        // Scroll to results
        this.results.scrollIntoView({ behavior: 'smooth' });
    }

    async verifyFileSignature() {
        const file = this.verifyFile.files[0];
        const signatureText = this.verifySignature.value.trim();
        const publicKeyPem = this.verifyPublicKey.value.trim();
        
        console.log('Verification started:', { 
            hasFile: !!file, 
            hasSignature: !!signatureText, 
            hasPublicKey: !!publicKeyPem 
        });
        
        if (!file || !signatureText || !publicKeyPem) {
            this.showError('Please provide a file, signature, and public key for verification.');
            return;
        }

        try {
            this.verifyButton.disabled = true;
            this.verifyButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
            
            console.log('Generating file hash...');
            // Generate file hash
            const fileHash = await this.generateFileHash(file);
            console.log('File hash generated:', fileHash);
            
            console.log('Parsing public key...');
            // Parse public key
            const publicKey = this.parsePublicKey(publicKeyPem);
            console.log('Public key parsed successfully');
            
            console.log('Verifying signature...');
            // Verify signature
            const isValid = this.verifyHash(fileHash, signatureText, publicKey);
            console.log('Verification result:', isValid);
            
            // Display result
            this.displayVerificationResult(isValid, fileHash);
            
        } catch (error) {
            console.error('Verification error:', error);
            this.showError('Error verifying signature: ' + error.message);
        } finally {
            this.verifyButton.disabled = false;
            this.verifyButton.innerHTML = '<i class="fas fa-check-circle"></i> Verify Signature';
        }
    }

    parsePublicKey(publicKeyPem) {
        try {
            return forge.pki.publicKeyFromPem(publicKeyPem);
        } catch (error) {
            throw new Error('Invalid public key format. Please provide a valid PEM-encoded public key.');
        }
    }

    verifyHash(hash, signatureBase64, publicKey) {
        try {
            // Convert hex hash to bytes
            const hashBytes = forge.util.hexToBytes(hash);
            
            // Decode signature
            const signature = forge.util.decode64(signatureBase64);
            
            // Verify signature using the raw hash bytes with no digest algorithm
            return publicKey.verify(hashBytes, signature, 'NONE');
        } catch (error) {
            throw new Error('Error verifying signature: ' + error.message);
        }
    }

    displayVerificationResult(isValid, fileHash) {
        const statusHtml = `
            <div class="verification-status ${isValid ? 'valid' : 'invalid'}">
                <i class="fas fa-${isValid ? 'check-circle' : 'times-circle'}"></i>
                <strong>${isValid ? 'Signature Valid' : 'Signature Invalid'}</strong>
                <p>File Hash: ${fileHash}</p>
                <p>${isValid ? 'This file was authentically signed by the private key owner.' : 'This file was not signed by the provided public key, or has been modified.'}</p>
            </div>
        `;
        
        this.resultStatus.innerHTML = statusHtml;
        this.verificationResult.style.display = 'block';
        
        // Scroll to result
        this.verificationResult.scrollIntoView({ behavior: 'smooth' });
    }

    async copyResultsToClipboard() {
        const results = {
            fileHash: this.fileHash.textContent,
            signature: this.signature.textContent,
            publicKey: this.publicKey.textContent,
            timestamp: new Date().toISOString()
        };
        
        const resultsText = `Digital Signature Results
Generated: ${results.timestamp}

File Hash (SHA-256):
${results.fileHash}

Digital Signature:
${results.signature}

Public Key:
${results.publicKey}`;

        try {
            await navigator.clipboard.writeText(resultsText);
            this.showSuccess('Results copied to clipboard!');
        } catch (error) {
            this.showError('Failed to copy to clipboard: ' + error.message);
        }
    }

    downloadResults() {
        const results = {
            fileHash: this.fileHash.textContent,
            signature: this.signature.textContent,
            publicKey: this.publicKey.textContent,
            timestamp: new Date().toISOString()
        };
        
        const resultsText = `Digital Signature Results
Generated: ${results.timestamp}

File Hash (SHA-256):
${results.fileHash}

Digital Signature:
${results.signature}

Public Key:
${results.publicKey}`;

        const blob = new Blob([resultsText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'digital-signature-results.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showSuccess('Results downloaded!');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showError(message) {
        // Create a simple error notification
        const notification = document.createElement('div');
        notification.className = 'notification error';
        notification.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${message}`;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    showSuccess(message) {
        // Create a simple success notification
        const notification = document.createElement('div');
        notification.className = 'notification success';
        notification.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new DigitalSigner();
}); 