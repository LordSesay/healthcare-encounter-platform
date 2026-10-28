import jenkins.model.*
import hudson.security.*
import jenkins.install.*

def instance = Jenkins.getInstance()

// Skip setup wizard permanently
instance.setInstallState(InstallState.INITIAL_SETUP_COMPLETED)

// Create admin user
def hudsonRealm = new HudsonPrivateSecurityRealm(false)
def adminPassword = System.getenv('JENKINS_ADMIN_PASSWORD') ?: 'admin123'
hudsonRealm.createAccount('admin', adminPassword)
instance.setSecurityRealm(hudsonRealm)

// Set authorization — admin has full access, logged-in users can read
def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
strategy.setAllowAnonymousRead(false)
instance.setAuthorizationStrategy(strategy)

instance.save()

println "==> Security configured. Admin user created."
