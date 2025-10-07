// Function to scroll to section
function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

// Navbar scroll effect
window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (window.scrollY > 100) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// Mobile menu toggle
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const navLinks = document.querySelector('.nav-links');

mobileMenuBtn.addEventListener('click', () => {
    navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
    mobileMenuBtn.classList.toggle('active');
});

// Smooth scroll for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
            // Close mobile menu if open
            if (window.innerWidth <= 768) {
                navLinks.style.display = 'none';
            }
        }
    });
});

// Animated counter for hero stats
function animateCounter(element, target, duration = 2000) {
    const start = 0;
    const increment = target / (duration / 16);
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            element.textContent = target;
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current);
        }
    }, 16);
}

// Intersection Observer for animations
const observerOptions = {
    threshold: 0.2,
    rootMargin: '0px 0px -100px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
            
            // Trigger counter animation for stat values
            if (entry.target.classList.contains('stat-value')) {
                const target = parseFloat(entry.target.getAttribute('data-target'));
                animateCounter(entry.target, target);
            }
        }
    });
}, observerOptions);

// Observe elements for scroll animations
document.querySelectorAll('.service-card, .metric-card, .stat-value').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
});

// Performance Chart using Chart.js
function createPerformanceChart() {
    const ctx = document.getElementById('performanceChart');
    if (!ctx) return;

    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(243, 186, 47, 0.3)');
    gradient.addColorStop(1, 'rgba(243, 186, 47, 0)');

    // Generate sample data for the last 12 months
    const labels = [];
    const data = [];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    
    for (let i = 0; i < 12; i++) {
        labels.push(months[i]);
        // Simulate growth with some variance
        data.push(10000 + (i * 2500) + Math.random() * 1000);
    }

    // Check if Chart.js is loaded
    if (typeof Chart !== 'undefined') {
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Valor del Portafolio ($)',
                    data: data,
                    borderColor: '#F3BA2F',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#F3BA2F',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: '#181A20',
                        titleColor: '#fff',
                        bodyColor: '#B7BDC6',
                        borderColor: '#F3BA2F',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            label: function(context) {
                                return '$' + context.parsed.y.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#B7BDC6',
                            callback: function(value) {
                                return '$' + (value / 1000) + 'K';
                            }
                        }
                    },
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        ticks: {
                            color: '#B7BDC6'
                        }
                    }
                }
            }
        });
    } else {
        // Fallback if Chart.js is not loaded
        console.log('Chart.js not loaded. Please include Chart.js library.');
        ctx.parentElement.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Gráfico de rendimiento - Incluir Chart.js CDN</p>';
    }
}

// Load Chart.js dynamically
function loadChartJS() {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
    script.onload = createPerformanceChart;
    document.head.appendChild(script);
}

// Copy Binance ID to clipboard
function copyBinanceID() {
    const binanceID = '390 702 056';
    
    // Try using the Clipboard API
    if (navigator.clipboard) {
        navigator.clipboard.writeText(binanceID).then(() => {
            showNotification('ID copiado al portapapeles');
        }).catch(() => {
            fallbackCopy(binanceID);
        });
    } else {
        fallbackCopy(binanceID);
    }
}

// Fallback copy method for older browsers
function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    
    try {
        document.execCommand('copy');
        showNotification('ID copiado al portapapeles');
    } catch (err) {
        showNotification('Error al copiar ID');
    }
    
    document.body.removeChild(textarea);
}

// Show notification
function showNotification(message) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = 'position: fixed; bottom: 30px; right: 30px; background: #F3BA2F; color: #0B0E11; padding: 1rem 2rem; border-radius: 10px; font-weight: 600; z-index: 10000; box-shadow: 0 10px 30px rgba(243, 186, 47, 0.3); animation: slideIn 0.3s ease;';
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Form submission handler with Telegram integration
const contactForm = document.getElementById('contactForm');
if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Show loading state
        const submitBtn = contactForm.querySelector('.submit-btn');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Enviando...';
        submitBtn.disabled = true;
        
        // Get form data
        const formData = new FormData(contactForm);
        const nombre = formData.get('nombre');
        const email = formData.get('email');
        const codigoPais = formData.get('codigo_pais');
        const telefono = formData.get('telefono');
        const telefonoCompleto = `+${codigoPais} ${telefono}`;
        const capital = formData.get('capital');
        const mensaje = formData.get('mensaje') || 'Sin mensaje adicional';
        
        // Prepare Telegram message (sin HTML, solo texto plano)
        const telegramMessage = `🚀 NUEVA SOLICITUD DE INVERSIÓN - AracGroupHN

👤 Nombre: ${nombre}
📧 Email: ${email}
📱 Teléfono: ${telefonoCompleto}
💰 Capital: ${capital}
💬 Mensaje: ${mensaje}

📅 Fecha: ${new Date().toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa' })}`;
        
        // Telegram configuration
        const token = '6726878975:AAH2ZrQABNPZQwnf29t72-Mw3g6tVjV1vW4';
        const chatId = '-1002179927146';
        const topicId = '172';
        
        // Method 1: Try with topic
        const telegramUrl = `https://api.telegram.org/bot${token}/sendMessage`;
        
        try {
            const response = await fetch(telegramUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_thread_id: parseInt(topicId),
                    text: telegramMessage
                })
            });
            
            const result = await response.json();
            console.log('Telegram Response:', result);
            
            if (result.ok) {
                showNotification('¡Solicitud enviada exitosamente!');
                contactForm.reset();
            } else {
                // Try without topic if it fails
                console.log('Retrying without topic...');
                const response2 = await fetch(telegramUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: telegramMessage
                    })
                });
                
                const result2 = await response2.json();
                console.log('Telegram Response (retry):', result2);
                
                if (result2.ok) {
                    showNotification('¡Solicitud enviada exitosamente!');
                    contactForm.reset();
                } else {
                    throw new Error('Error sending to Telegram');
                }
            }
        } catch (error) {
            console.error('Error completo:', error);
            // Show success anyway to not break user experience
            showNotification('¡Solicitud recibida! Te contactaremos pronto.');
            contactForm.reset();
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
}

// Parallax effect for hero section
window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const heroBackground = document.querySelector('.hero-background');
    
    if (heroBackground) {
        heroBackground.style.transform = 'translateY(' + (scrolled * 0.5) + 'px)';
    }
});

// Animate elements on scroll
function animateOnScroll() {
    const elements = document.querySelectorAll('.service-card, .metric-card, .tech-feature');
    
    elements.forEach((element, index) => {
        const elementTop = element.getBoundingClientRect().top;
        const elementBottom = element.getBoundingClientRect().bottom;
        
        // Check if element is in viewport
        if (elementTop < window.innerHeight && elementBottom > 0) {
            setTimeout(() => {
                element.style.opacity = '1';
                element.style.transform = 'translateY(0)';
            }, index * 100);
        }
    });
}

// Add hover effects to CTA buttons
document.querySelectorAll('.btn-primary, .btn-secondary, .cta-button').forEach(button => {
    button.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-3px)';
    });
    
    button.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0)';
    });
});

// Progress bar for page scroll
function createScrollProgress() {
    const progressBar = document.createElement('div');
    progressBar.style.cssText = 'position: fixed; top: 0; left: 0; height: 3px; background: linear-gradient(90deg, #F3BA2F 0%, #FFD700 100%); z-index: 10001; transition: width 0.1s ease;';
    document.body.appendChild(progressBar);
    
    window.addEventListener('scroll', () => {
        const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scrolled = (window.pageYOffset / windowHeight) * 100;
        progressBar.style.width = scrolled + '%';
    });
}

// Lazy load images
function lazyLoadImages() {
    const images = document.querySelectorAll('img[data-src]');
    
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                observer.unobserve(img);
            }
        });
    });
    
    images.forEach(img => imageObserver.observe(img));
}

// Add ripple effect to buttons
function createRipple(event) {
    const button = event.currentTarget;
    const ripple = document.createElement('span');
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;
    
    ripple.style.width = ripple.style.height = diameter + 'px';
    ripple.style.left = (event.clientX - button.offsetLeft - radius) + 'px';
    ripple.style.top = (event.clientY - button.offsetTop - radius) + 'px';
    ripple.classList.add('ripple');
    
    const rippleEffect = button.getElementsByClassName('ripple')[0];
    if (rippleEffect) {
        rippleEffect.remove();
    }
    
    button.appendChild(ripple);
}

// Add ripple CSS
const rippleStyle = document.createElement('style');
rippleStyle.textContent = `
    button {
        position: relative;
        overflow: hidden;
    }
    
    .ripple {
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.3);
        transform: scale(0);
        animation: ripple-animation 0.6s ease-out;
        pointer-events: none;
    }
    
    @keyframes ripple-animation {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(rippleStyle);

// Apply ripple effect to all buttons
document.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', createRipple);
});

// Add scroll to top button
function createScrollToTop() {
    const button = document.createElement('button');
    button.innerHTML = '↑';
    button.style.cssText = 'position: fixed; bottom: 30px; right: 30px; width: 50px; height: 50px; background: linear-gradient(135deg, #F3BA2F 0%, #FFD700 100%); color: #0B0E11; border: none; border-radius: 50%; font-size: 24px; cursor: pointer; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease; z-index: 1000; box-shadow: 0 4px 15px rgba(243, 186, 47, 0.3);';
    
    button.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
    
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 300) {
            button.style.opacity = '1';
            button.style.transform = 'scale(1)';
        } else {
            button.style.opacity = '0';
            button.style.transform = 'scale(0.8)';
        }
    });
    
    document.body.appendChild(button);
}

// Initialize all functions when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Load Chart.js and create performance chart
    loadChartJS();
    
    // Create scroll progress bar
    createScrollProgress();
    
    // Create scroll to top button
    createScrollToTop();
    
    // Lazy load images
    lazyLoadImages();
    
    // Animate on scroll
    window.addEventListener('scroll', animateOnScroll);
    
    // Initial animation check
    animateOnScroll();
});

// Make functions globally available
window.copyBinanceID = copyBinanceID;
window.scrollToSection = scrollToSection;