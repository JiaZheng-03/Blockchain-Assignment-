import { Link } from 'react-router-dom';

function Login() {
  return (
    <div className="form-card" style={{ maxWidth: 480, margin: '2rem auto' }}>
      <h3>Welcome Back</h3>
      <p>Sign in to continue managing your agreements.</p>
      <form className="form-grid">
        <label>
          Email
          <input type="email" placeholder="you@example.com" />
        </label>
        <label>
          Password
          <input type="password" placeholder="Enter password" />
        </label>
        <button className="btn btn-primary" type="submit">
          Login
        </button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        New here? <Link to="/register">Create an account</Link>
      </p>
    </div>
  );
}

export default Login;
