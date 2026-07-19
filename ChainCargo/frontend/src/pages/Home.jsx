import { Link } from 'react-router-dom';

function Home() {
  return (
    <section className="hero">
      <div>
        <h1>Secure logistics payments with blockchain escrow.</h1>
        <p>
          ChainCargo helps shippers and carriers manage milestone-based payments with
          transparent on-chain agreements.
        </p>
        <div className="hero-actions">
          <Link className="btn btn-primary" to="/register">
            Get Started
          </Link>
          <Link className="btn btn-secondary" to="/dashboard">
            View Dashboard
          </Link>
        </div>
      </div>
      <div className="panel">
        <h3>Why ChainCargo</h3>
        <ul>
          <li>Escrow protected payments</li>
          <li>Milestone-based release logic</li>
          <li>MetaMask-ready blockchain flow</li>
        </ul>
      </div>
    </section>
  );
}

export default Home;
