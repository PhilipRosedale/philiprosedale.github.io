document.addEventListener('DOMContentLoaded', () => {
    // Smooth scrolling for navigation links
    document.querySelectorAll('nav a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 70,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Add active class to navigation items on scroll
    const sections = document.querySelectorAll('section[id]');
    
    function highlightNavOnScroll() {
        const scrollY = window.pageYOffset;
        
        sections.forEach(section => {
            const sectionHeight = section.offsetHeight;
            const sectionTop = section.offsetTop - 100;
            const sectionId = section.getAttribute('id');
            
            if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                document.querySelector(`nav a[href="#${sectionId}"]`)?.classList.add('active');
            } else {
                document.querySelector(`nav a[href="#${sectionId}"]`)?.classList.remove('active');
            }
        });
    }
    
    window.addEventListener('scroll', highlightNavOnScroll);

    // Add CSS style for the active nav item
    const style = document.createElement('style');
    style.textContent = `
        nav a.active {
            background-color: var(--accent-color);
        }
    `;
    document.head.appendChild(style);

    // Writings: show only first 8, expand on "More..."
    const writingItems = document.querySelectorAll('.writing-item');
    const moreBtn = document.getElementById('writings-more-btn');
    const searchInput = document.getElementById('writings-search');
    const VISIBLE_COUNT = 8;
    let expanded = false;

    if (writingItems.length > VISIBLE_COUNT) {
        writingItems.forEach((item, i) => {
            if (i >= VISIBLE_COUNT) item.classList.add('writing-hidden');
        });
        if (moreBtn) {
            moreBtn.addEventListener('click', () => {
                expanded = true;
                writingItems.forEach(item => item.classList.remove('writing-hidden'));
                moreBtn.classList.add('hidden');
            });
        }
    } else if (moreBtn) {
        moreBtn.classList.add('hidden');
    }

    // Writings search
    if (searchInput) {
        let noResults = document.querySelector('.writings-no-results');

        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim().toLowerCase();

            if (!query) {
                // Restore default state
                writingItems.forEach((item, i) => {
                    item.classList.remove('writing-search-hidden');
                    if (!expanded && i >= VISIBLE_COUNT) {
                        item.classList.add('writing-hidden');
                    }
                });
                if (moreBtn && !expanded && writingItems.length > VISIBLE_COUNT) {
                    moreBtn.classList.remove('hidden');
                }
                if (noResults) noResults.remove();
                noResults = null;
                return;
            }

            // While searching, disable the truncation
            if (moreBtn) moreBtn.classList.add('hidden');
            let matchCount = 0;

            writingItems.forEach(item => {
                item.classList.remove('writing-hidden');
                const title = (item.querySelector('h3')?.textContent || '').toLowerCase();
                const desc = (item.querySelector('p')?.textContent || '').toLowerCase();
                if (title.includes(query) || desc.includes(query)) {
                    item.classList.remove('writing-search-hidden');
                    matchCount++;
                } else {
                    item.classList.add('writing-search-hidden');
                }
            });

            if (matchCount === 0) {
                if (!noResults) {
                    noResults = document.createElement('p');
                    noResults.className = 'writings-no-results';
                    const list = document.querySelector('.writing-list');
                    list.parentNode.insertBefore(noResults, list.nextSibling);
                }
                noResults.textContent = 'No articles found.';
            } else if (noResults) {
                noResults.remove();
                noResults = null;
            }
        });
    }

    // Add hover effects to cards
    const cards = document.querySelectorAll('.writing-card, .video-card, .patent-card');
    
    cards.forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-10px)';
            card.style.boxShadow = '0 15px 30px rgba(0, 0, 0, 0.15)';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
            card.style.boxShadow = '';
        });
    });

    // Replace placeholder image with an actual image
    const profilePhoto = document.getElementById('profile-photo');
    if (profilePhoto && profilePhoto.src.includes('placehold.co')) {
        // Only replace if it's still a placeholder
        profilePhoto.src = 'philip.avif';
    }

    // Add animation to section headings when they come into view
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Select all section headings
    const sectionHeadings = document.querySelectorAll('.section h2');
    
    // Add initial styles and observe each heading
    sectionHeadings.forEach(heading => {
        heading.style.opacity = '0';
        heading.style.transform = 'translateY(20px)';
        heading.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(heading);
    });

    // Enhance video cards with better YouTube functionality
    const videoCards = document.querySelectorAll('.video-card');
    
    videoCards.forEach(card => {
        const link = card.querySelector('.watch-video');
        const thumbnail = card.querySelector('.video-thumbnail img');
        
        if (link && thumbnail) {
            // Extract video ID from the YouTube URL
            const videoUrl = link.getAttribute('href');
            const videoId = videoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
            
            if (videoId && videoId[1]) {
                // Set higher quality thumbnail if available
                thumbnail.onerror = () => {
                    // Fallback to standard quality if high quality not available
                    thumbnail.src = `https://img.youtube.com/vi/${videoId[1]}/hqdefault.jpg`;
                };
                
                // Add play button overlay
                const playButton = document.createElement('div');
                playButton.classList.add('play-button');
                card.querySelector('.video-thumbnail').appendChild(playButton);
                
                // Make the play button clickable
                playButton.style.cursor = 'pointer';
                playButton.addEventListener('click', () => {
                    window.open(videoUrl, '_blank');
                });
                
                // Also make the thumbnail clickable
                card.querySelector('.video-thumbnail').style.cursor = 'pointer';
                card.querySelector('.video-thumbnail').addEventListener('click', (e) => {
                    // Only trigger if clicking directly on the thumbnail (not on the play button)
                    if (e.target === thumbnail) {
                        window.open(videoUrl, '_blank');
                    }
                });
            }
        }
    });

    // Add CSS for play button
    const playButtonStyle = document.createElement('style');
    playButtonStyle.textContent = `
        .video-thumbnail {
            position: relative;
        }
        .play-button {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 60px;
            height: 60px;
            background-color: rgba(0, 0, 0, 0.7);
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            opacity: 0.8;
            transition: opacity 0.3s ease;
        }
        .play-button::after {
            content: '';
            display: block;
            width: 0;
            height: 0;
            border-top: 12px solid transparent;
            border-left: 20px solid white;
            border-bottom: 12px solid transparent;
            margin-left: 5px;
        }
        .video-card:hover .play-button {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1.1);
        }
    `;
    document.head.appendChild(playButtonStyle);
}); 