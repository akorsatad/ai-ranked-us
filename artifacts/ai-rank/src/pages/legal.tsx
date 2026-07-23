import React from 'react';

function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: {updated}</p>
      <div className="space-y-8 text-sm leading-relaxed text-foreground/90 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-2 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1">
        {children}
      </div>
    </div>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="July 23, 2026">
      <section>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using AI Ranked US ("the Service"), available at airanked.us, you agree to be
          bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
        </p>
      </section>
      <section>
        <h2>2. Description of the Service</h2>
        <p>
          AI Ranked US is an analytics platform that tracks how third-party artificial intelligence models
          rank, mention, and describe brands across various industries. The Service aggregates and presents
          rankings, sentiment estimates, and historical trends derived from AI model outputs.
        </p>
      </section>
      <section>
        <h2>3. Nature of Rankings and Disclaimers</h2>
        <p>
          Rankings and sentiment data shown on the Service are generated from the outputs of third-party AI
          models. These outputs are probabilistic, may change over time, and do not represent factual
          assessments, endorsements, or objective evaluations of any brand by AI Ranked US.
        </p>
        <ul>
          <li>The Service is provided "as is" and "as available", without warranties of any kind, express or implied.</li>
          <li>We do not guarantee the accuracy, completeness, or timeliness of any ranking or sentiment data.</li>
          <li>You should not rely on the Service as the sole basis for business, investment, or purchasing decisions.</li>
        </ul>
      </section>
      <section>
        <h2>4. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Scrape, harvest, or bulk-download data from the Service without prior written permission;</li>
          <li>Interfere with or disrupt the Service, its servers, or networks;</li>
          <li>Misrepresent data from the Service as official statements by the brands shown or by AI Ranked US;</li>
          <li>Use the Service for any unlawful purpose.</li>
        </ul>
      </section>
      <section>
        <h2>5. Intellectual Property</h2>
        <p>
          The Service, including its design, compiled data presentations, and content (excluding third-party
          brand names and trademarks, which remain the property of their respective owners), is owned by
          AI Ranked US. Brand names appear for identification and informational purposes only.
        </p>
      </section>
      <section>
        <h2>6. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, AI Ranked US shall not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or
          goodwill arising from your use of, or inability to use, the Service.
        </p>
      </section>
      <section>
        <h2>7. Changes to the Service and Terms</h2>
        <p>
          We may modify or discontinue the Service, or update these Terms, at any time. Continued use of the
          Service after changes take effect constitutes acceptance of the revised Terms.
        </p>
      </section>
      <section>
        <h2>8. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the United States and the state in which AI Ranked US is
          organized [governing law jurisdiction to be specified], without regard to conflict-of-law principles.
        </p>
      </section>
      <section>
        <h2>9. Contact</h2>
        <p>
          Questions about these Terms may be sent to <a className="text-primary underline" href="mailto:legal@airanked.us">legal@airanked.us</a>.
        </p>
      </section>
    </LegalPage>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="July 23, 2026">
      <section>
        <h2>1. Overview</h2>
        <p>
          This Privacy Policy describes how AI Ranked US ("we", "us") collects, uses, and protects
          information when you use airanked.us.
        </p>
      </section>
      <section>
        <h2>2. Information We Collect</h2>
        <ul>
          <li><strong>Usage data:</strong> pages visited, features used, timestamps, and general interaction data.</li>
          <li><strong>Technical data:</strong> IP address, browser type, device information, and referring URLs, collected automatically through standard web logs.</li>
          <li><strong>Information you provide:</strong> if you submit a brand for ranking or contact us, we collect the information you choose to provide (such as a brand name or email address).</li>
        </ul>
        <p>We do not knowingly collect personal information from children under 13.</p>
      </section>
      <section>
        <h2>3. Cookies</h2>
        <p>
          We use cookies and similar technologies that are necessary for the Service to function (such as
          session management) and, where applicable, to understand aggregate usage of the site. You can
          control cookies through your browser settings; disabling essential cookies may affect functionality.
        </p>
      </section>
      <section>
        <h2>4. Third-Party AI Providers</h2>
        <p>
          To generate rankings, we send brand- and industry-related prompts to third-party AI model providers
          (such as OpenAI, Anthropic, and Google). These prompts do not include your personal information.
          The providers' own terms and privacy policies govern their processing of the data we send them.
        </p>
      </section>
      <section>
        <h2>5. How We Use Information</h2>
        <ul>
          <li>To operate, maintain, and improve the Service;</li>
          <li>To monitor performance, prevent abuse, and secure the platform;</li>
          <li>To respond to inquiries and requests you send us;</li>
          <li>To produce aggregated, non-identifying analytics about the Service.</li>
        </ul>
      </section>
      <section>
        <h2>6. Sharing of Information</h2>
        <p>
          We do not sell your personal information. We may share information with service providers who help
          us operate the platform (such as hosting and email delivery providers), when required by law, or in
          connection with a business transfer.
        </p>
      </section>
      <section>
        <h2>7. Data Retention and Security</h2>
        <p>
          We retain data only as long as needed for the purposes described here and apply reasonable
          technical and organizational safeguards. No method of transmission or storage is 100% secure.
        </p>
      </section>
      <section>
        <h2>8. Your Rights</h2>
        <p>
          Depending on your jurisdiction, you may have rights to access, correct, or delete your personal
          information. To exercise these rights, contact us at the address below.
        </p>
      </section>
      <section>
        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. The "Last updated" date above reflects the
          most recent revision.
        </p>
      </section>
      <section>
        <h2>10. Contact</h2>
        <p>
          Privacy questions may be sent to <a className="text-primary underline" href="mailto:privacy@airanked.us">privacy@airanked.us</a>.
        </p>
      </section>
    </LegalPage>
  );
}
