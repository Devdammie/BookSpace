import { Link } from 'react-router-dom';

export function LandingPage() {
  return (
    <div className="login-screen">
      <div className="card login-card grid">
        <div className="brand">
          <h1>BookSpace</h1>
          <p className="muted">Equipment and room booking for your department.</p>
        </div>
        <p>Create a department workspace, invite your team, and manage approvals in one place.</p>
        <div className="inline">
          <Link className="button" to="/signup">
            Create a department
          </Link>
          <Link className="button secondary" to="/o/demo/login">
            Sign in to demo
          </Link>
        </div>
        <p className="muted">Already have a workspace? Open <code>/o/your-slug/login</code>.</p>
      </div>
    </div>
  );
}
