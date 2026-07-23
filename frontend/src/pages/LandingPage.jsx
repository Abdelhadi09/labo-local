import React, {useEffect, useRef, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {
    ArrowRight,
    CheckCircle2,
    ChevronDown,
    ClipboardPlus,
    Clock3,
    FileUp,
    HeartPulse,
    MapPin,
    Menu,
    Microscope,
    Search,
    ShieldCheck,
    Stethoscope,
    X
} from 'lucide-react';
import './LandingPage.css';
import {useIsMobile} from '../hooks/useIsMobile';
import {TestimonialsCard} from '../components/ui/testimonials-card.jsx';


const NAV_LINKS = [
    {
        label: 'Nos services',
        href: '#services'
    }, {
        label: 'Comment ça marche',
        href: '#comment-ca-marche'
    }, {
        label: 'Infirmiers à domicile',
        href: '#nurse'
    }, {
        label: 'Contact',
        href: '#contact'
    }
];

const BENEFITS = [
    {
        icon: Microscope,
        title: 'Analyses encadrées',
        text: 'Un parcours numérique conçu pour simplifier vos demandes.'
    }, {
        icon: ShieldCheck,
        title: 'Confidentialité',
        text: 'Vos informations de santé restent dans votre espace sécurisé.'
    }, {
        icon: Clock3,
        title: 'Suivi centralisé',
        text: 'Retrouvez vos demandes et résultats au même endroit.'
    }, {
        icon: HeartPulse,
        title: 'Accompagnement',
        text: 'Demandez un prélèvement à domicile selon la couverture disponible.'
    }
];

const FAQS = [
    [
        'Comment déposer une ordonnance ?', 'Créez votre espace, ajoutez une photo ou un fichier de votre ordonnance, puis su' +
                'ivez son traitement depuis votre tableau de bord.'
    ],
    [
        'Puis-je demander un prélèvement à domicile ?', 'Oui. Après avoir déposé votre demande, vous pouvez indiquer votre adresse et vos' +
                ' préférences. La disponibilité dépend de votre zone de couverture.'
    ],
    [
        'Comment mes données sont-elles utilisées ?', 'Elles servent uniquement au traitement et au suivi de votre demande, dans votre ' +
                'espace personnel sécurisé.'
    ]
];

export default function LandingPage() {
    const navigate = useNavigate();
    const [mobileMenuOpen,
        setMobileMenuOpen] = useState(false);
    const [openFaq,
        setOpenFaq] = useState(null);
    const menuTriggerRef = useRef(null);
    const dialogRef = useRef(null);
    const isMobile = useIsMobile();

    const closeMenu = () => setMobileMenuOpen(false);

    useEffect(() => {
        if (!mobileMenuOpen) 
            return undefined;
        const previousOverflow = document.body.style.overflow;
        const focusableSelector = 'a[href], button:not([disabled])';
        const focusMenu = () => dialogRef.current
            ?.querySelector(focusableSelector)
                ?.focus();
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') 
                closeMenu();
            if (event.key !== 'Tab') 
                return;
            const focusable = [...(dialogRef.current
                    ?.querySelectorAll(focusableSelector) || [])];
            if (!focusable.length) 
                return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', handleKeyDown);
        focusMenu();
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
            menuTriggerRef.current
                ?.focus();
        };
    }, [mobileMenuOpen]);

    const steps = [
        ['01', ClipboardPlus, 'Créez votre espace', 'Renseignez vos informations pour démarrer votre parcours.'],
        ['02', FileUp, 'Déposez votre ordonnance', 'Ajoutez votre document et choisissez les services dont vous avez besoin.'],
        ['03', HeartPulse, 'Suivez votre demande', 'Retrouvez l’avancement et les informations utiles dans votre espace.']
    ];

    return (
        <main className="landing-page">
            <a className="landing-skip-link" href="#main-content">Aller au contenu</a>
            <section className="landing-hero-shell">
                <nav className="landing-nav" aria-label="Navigation principale">
                    <div className="landing-container landing-nav-inner">
                        <Link to="/" className="landing-brand" aria-label="BioLin, accueil">BioLin</Link>
                        <div className="landing-nav-links">{NAV_LINKS.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}</div>
                        <div className="landing-nav-actions">
                           
                            <Link to="/login" className="landing-login-link">Connexion</Link>
                            <button
                                ref={menuTriggerRef}
                                type="button"
                                className="landing-icon-button landing-menu-toggle"
                                aria-label="Ouvrir le menu"
                                aria-expanded={mobileMenuOpen}
                                aria-controls="mobile-menu"
                                onClick={() => setMobileMenuOpen(true)}><Menu size={23}/></button>
                        </div>
                    </div>
                </nav>
                <div className="landing-container landing-hero" id="main-content">
                    <div className="landing-hero-copy">
                        <p className="landing-eyebrow">Laboratoire & soins à domicile</p>
                        <h1>Votre santé, suivie avec
                            <em>clarté.</em>
                        </h1>
                        <p className="landing-lead">Déposez votre ordonnance, suivez votre demande et
                            demandez un prélèvement à domicile depuis un seul espace.</p>
                        <div className="landing-hero-actions">
                            <button
                                type="button"
                                onClick={() => navigate('/register')}
                                className="landing-button landing-button-primary">Accéder à mon espace
                                <ArrowRight size={19}/></button>
                           
                        </div>
                    </div>
                    <figure className="landing-hero-image">
                        <img
                            src="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1200&q=85"
                            alt="Professionnelle de santé dans un environnement clinique"/>
                        <figcaption><ShieldCheck size={18}/>
                            Un espace pensé pour vos données de santé</figcaption>
                    </figure>
                </div>
            </section>

            {mobileMenuOpen && <div className="landing-mobile-overlay" role="presentation">
                <div
                    ref={dialogRef}
                    id="mobile-menu"
                    className="landing-mobile-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Menu principal">
                    <button
                        type="button"
                        className="landing-icon-button landing-mobile-close"
                        aria-label="Fermer le menu"
                        onClick={closeMenu}><X size={25}/></button>
                    <div className="landing-mobile-links">{NAV_LINKS.map((link) => <a key={link.label} href={link.href} onClick={closeMenu}>{link.label}</a>)}
                        <Link to="/login" onClick={closeMenu}>Connexion</Link>
                    </div>
                </div>
            </div>}

            <section className="landing-benefits" aria-label="Nos engagements">
                <div className="landing-container landing-benefit-grid">{BENEFITS.map(({icon: Icon, title, text}) => <article key={title}><Icon aria-hidden="true" size={25}/>
                        <div>
                            <h2>{title}</h2>
                            <p>{text}</p>
                        </div>
                    </article>)}</div>
            </section>

            <section
                className="landing-section landing-section-soft"
                id="comment-ca-marche">
                <div className="landing-container">
                    <p className="landing-kicker">Comment ça marche</p>
                    <div className="landing-section-heading">
                        <h2>Un parcours simple, étape par étape.</h2>
                    </div>
                    <div className="landing-steps-container">
            {steps.map(([number, Icon, title, text], index) => (
                // Add an 'active' class to the second item to match the design
                <article key={number} className={`step-item ${index === 1 ? 'active' : ''}`}>
                    
                    {/* The circle and connecting line */}
                    <div className="step-indicator">
                        <span className="step-number">{number}</span>
                    </div>

                    {/* The text content and icon */}
                    <div className="step-content">
                        {/* Optional: You can remove the icon if you want to strictly match the image */}
                       
                        <h3>{title}</h3>
                        <p>{text}</p>
                    </div>

                </article>
            ))}
        </div>
                </div>
            </section>

            <section className="landing-section" id="services">
                <div className="landing-container">
                    <p className="landing-kicker">Nos services</p>
                    <div className="landing-section-heading">
                        <h2>Des services utiles, au rythme de votre quotidien.</h2>
                    </div>
                    
                       
                     {isMobile &&  <TestimonialsCard
    items={[
        {
            id: 1,
            image: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=900&q=80",
            title: "Suivi simplifié",
            description:
                "Grâce à BioLin, j’ai pu déposer mon ordonnance et suivre l’avancement de mes analyses sans stress.",
        },
        {
            id: 2,
            image: "https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=900&q=80",
            title: "Service à domicile",
            description:
                "J’ai pu demander un prélèvement à domicile facilement, et le suivi était clair et rassurant.",
        },
        {
            id: 3,
            image: "https://images.unsplash.com/photo-1584982751601-97dcc096659c?auto=format&fit=crop&w=900&q=80",
            title: "Confidentialité assurée",
            description:
                "Toutes mes informations de santé sont restées confidentielles et sécurisées dans mon espace BioLin.",
        },
    ]}
/>}
{!isMobile && <div
                        className="landing-service-grid">
    <article><img
                            src="https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80"
                            alt="Matériel de laboratoire pour analyses médicales"/>
                            <div><Microscope size={24}/>
                                <h3>Analyses médicales</h3>
                                <p>Centralisez vos demandes d’analyses depuis votre espace personnel.</p>
                            </div>
                        </article>
                        <article><img
                            src="https://images.unsplash.com/photo-1584982751601-97dcc096659c?auto=format&fit=crop&w=900&q=80"
                            alt="Professionnel de santé consultant un dossier médical"/>
                            <div><FileUp size={24}/>
                                <h3>Dépôt d’ordonnance</h3>
                                <p>Envoyez une ordonnance lisible et gardez le suivi de son traitement.</p>
                            </div>
                        </article>
                        <article id="nurse"><img
                            src="https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=900&q=80"
                            alt="Infirmière échangeant avec une patiente à domicile"/>
                            <div><Stethoscope size={24}/>
                                <h3>Infirmier à domicile</h3>
                                <p>Demandez une visite selon les créneaux et la couverture disponibles.</p>
                            </div>
                        </article>
                        </div>
}
                    
                </div>
            </section>

            <section className="landing-section landing-trust">
                <div className="landing-container landing-trust-layout">
                    <div>
                        <p className="landing-kicker">Une relation de confiance</p>
                        <h2>Des repères clairs pour chaque demande.</h2>
                        <p>BioLin vous aide à organiser votre parcours de santé, sans promesses
                            médicales imprécises.</p>
                    </div>
                    <ul>
                        <li><CheckCircle2/>
                            Un espace personnel pour consulter vos demandes</li>
                        <li><CheckCircle2/>
                            Des informations de santé traitées de manière confidentielle</li>
                        <li><CheckCircle2/>
                            Un suivi des étapes visible depuis votre tableau de bord</li>
                    </ul>
                </div>
            </section>

            <section className="landing-section landing-proof">
                <div className="landing-container landing-proof-layout">
                    <div className="landing-proof-quote">
                        <p className="landing-kicker">Preuve opérationnelle</p>
                        <blockquote>“Le dépôt d’ordonnance et le suivi sont regroupés dans le même
                            espace, ce qui évite de chercher l’information à plusieurs endroits.”</blockquote>
                        <p>Fonctionnalité disponible dans l’espace client BioLin.</p>
                    </div>
                    <div className="landing-proof-cta">
                        <h2>Prêt à commencer ?</h2>
                        <p>Créez votre espace pour déposer votre ordonnance et suivre votre demande.</p>
                        <Link to="/register" className="landing-button landing-button-primary">Déposer une ordonnance
                            <ArrowRight size={19}/></Link>
                    </div>
                </div>
            </section>

            <section className="landing-section landing-section-soft">
                <div className="landing-container landing-location">
                    <div>
                        <p className="landing-kicker">Agences & couverture</p>
                        <h2>Une prise en charge orientée vers l’agence la plus adaptée.</h2>
                        <p>Les informations d’agence et la disponibilité des visites à domicile sont
                            communiquées pendant votre demande. Elles peuvent varier selon votre
                            localisation.</p>
                    </div>
                    <div className="landing-location-card"><MapPin size={26}/>
                        <h3>Besoin d’une visite à domicile ?</h3>
                        <p>Indiquez votre adresse et vos préférences dans votre espace pour vérifier la
                            prise en charge.</p>
                        <Link to="/register">Vérifier ma couverture
                            <ArrowRight size={17}/></Link>
                    </div>
                </div>
            </section>

            <section className="landing-section" aria-labelledby="faq-title">
                <div className="landing-container landing-faq">
                    <div>
                        <p className="landing-kicker">Questions fréquentes</p>
                        <h2 id="faq-title">Les réponses essentielles.</h2>
                    </div>
                    <div>{FAQS.map(([
                            question, answer
                        ], index) => <article key={question} className="landing-faq-item">
                            <h3>
                                <button
                                    type="button"
                                    aria-expanded={openFaq === index}
                                    aria-controls={`faq-${index}`}
                                    onClick={() => setOpenFaq(openFaq === index
                                    ? null
                                    : index)}>{question}<ChevronDown
                                    aria-hidden="true"
                                    className={openFaq === index
                            ? 'is-open'
                            : ''}/></button>
                            </h3>{openFaq === index && <p id={`faq-${index}`}>{answer}</p>}</article>)}</div>
                </div>
            </section>

            <footer className="landing-footer" id="contact">
                <div className="landing-container">
                    <div>
                        <Link to="/" className="landing-brand">BioLin</Link>
                        <p>Votre espace pour organiser vos analyses et demandes de soins à domicile.</p>
                    </div>
                    <div>
                        <h2>Contact</h2>
                        <p>Connectez-vous à votre espace pour le suivi d’une demande existante.</p>
                        <Link to="/login">Accéder à mon espace
                            <ArrowRight size={16}/></Link>
                    </div>
                </div>
                <p className="landing-footer-bottom">© {new Date().getFullYear()}
                    BioLin. Informations indicatives — disponibilité à confirmer lors de votre
                    demande.</p>
            </footer>
        </main>
    );
}
