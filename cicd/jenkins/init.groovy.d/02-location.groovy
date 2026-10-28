import jenkins.model.*

def instance = Jenkins.getInstance()
def config = JenkinsLocationConfiguration.get()

def url = System.getenv('JENKINS_URL') ?: 'http://localhost:8080/'
config.setUrl(url)
config.save()

println "==> Jenkins URL set to ${url}"
