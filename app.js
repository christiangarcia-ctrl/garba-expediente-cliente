(() => {
  const form = document.getElementById('clientForm');
  const steps = [...document.querySelectorAll('.step')];
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const submitBtn = document.getElementById('submitBtn');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const missingCount = document.getElementById('missingCount');
  const beneficiaries = document.getElementById('beneficiaries');
  const beneficiaryTemplate = document.getElementById('beneficiaryTemplate');
  const addBeneficiaryBtn = document.getElementById('addBeneficiary');
  const beneficiaryTotal = document.getElementById('beneficiaryTotal');
  const addressHelper = document.getElementById('addressHelper');
  const addressTitle = document.getElementById('addressTitle');
  const sourceNote = document.getElementById('sourceNote');
  const reviewCard = document.getElementById('reviewCard');
  const submitMessage = document.getElementById('submitMessage');

  let currentStep = 0;
  let beneficiarySeq = 0;

  function showStep(index) {
    currentStep = Math.max(0, Math.min(index, steps.length - 1));
    steps.forEach((step, i) => step.classList.toggle('active', i === currentStep));
    const pct = ((currentStep + 1) / steps.length) * 100;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `Paso ${currentStep + 1} de ${steps.length}`;
    prevBtn.disabled = currentStep === 0;
    nextBtn.classList.toggle('hidden', currentStep === steps.length - 1);
    submitBtn.classList.toggle('hidden', currentStep !== steps.length - 1);

    if (currentStep === 1) prepareAddressStep();
    if (currentStep === steps.length - 1) renderReview();
    updateMissingCount();
    window.scrollTo({ top: document.getElementById('clientForm').offsetTop - 16, behavior: 'smooth' });
  }

  function setInvalid(el, invalid) {
    const field = el.closest('.field') || el;
    field.classList.toggle('invalid', invalid);
  }

  function validateInput(input) {
    if (input.type === 'radio') {
      const checked = form.querySelector(`input[name="${input.name}"]:checked`);
      const group = input.closest('[data-required-group]') || input.closest('fieldset');
      if (group) group.classList.toggle('invalid', !checked);
      return Boolean(checked);
    }

    let valid = input.checkValidity();
    if (input.name === 'phone' && input.value) {
      valid = input.value.replace(/\D/g, '').length >= 10;
    }
    setInvalid(input, !valid);
    return valid;
  }

  function validateStep(step) {
    const required = [...step.querySelectorAll('[required]')];
    let allValid = true;
    const radioNames = new Set();

    for (const input of required) {
      if (input.type === 'radio') {
        if (radioNames.has(input.name)) continue;
        radioNames.add(input.name);
      }
      if (!validateInput(input)) allValid = false;
    }

    if (step.dataset.step === '3') {
      const total = getBeneficiaryTotal();
      if (total !== 100) {
        beneficiaryTotal.textContent = `Los porcentajes deben sumar 100%. Actualmente suman ${total}%.`;
        beneficiaryTotal.style.color = 'var(--danger)';
        allValid = false;
      }
    }

    updateMissingCount(step);
    if (!allValid) {
      const firstInvalid = step.querySelector('.invalid input, .field.invalid, fieldset.invalid');
      firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return allValid;
  }

  function updateMissingCount(step = steps[currentStep]) {
    const required = [...step.querySelectorAll('[required]')];
    let missing = 0;
    const radioNames = new Set();

    for (const input of required) {
      if (input.type === 'radio') {
        if (radioNames.has(input.name)) continue;
        radioNames.add(input.name);
        if (!form.querySelector(`input[name="${input.name}"]:checked`)) missing++;
      } else if (!input.checkValidity()) {
        missing++;
      }
    }

    if (step.dataset.step === '3' && getBeneficiaryTotal() !== 100) missing++;
    missingCount.textContent = missing ? `Faltan ${missing} dato${missing === 1 ? '' : 's'}` : 'Completo';
  }

  function handleAddressSource() {
    const selected = form.querySelector('input[name="addressSource"]:checked')?.value;
    const copy = {
      ine: 'Tomaremos el domicilio de tu INE como referencia. En el siguiente paso confírmalo y corrige cualquier dato si es necesario.',
      proof: 'Tomaremos el domicilio de tu comprobante como referencia. En el siguiente paso confírmalo y corrige cualquier dato si es necesario.',
      other: 'Como tu domicilio actual es diferente, en el siguiente paso escríbelo tal como debe quedar en tu expediente.'
    };
    sourceNote.textContent = selected ? copy[selected] : '';
    sourceNote.classList.toggle('visible', Boolean(selected));
  }

  function prepareAddressStep() {
    const selected = form.querySelector('input[name="addressSource"]:checked')?.value;
    const sourceName = selected === 'ine'
      ? 'tu INE'
      : selected === 'proof'
        ? 'tu comprobante de domicilio'
        : 'los documentos';

    if (selected === 'other') {
      addressTitle.textContent = 'Escribe tu domicilio actual';
      addressHelper.textContent = 'Captura la dirección que debemos utilizar en tu expediente.';
    } else {
      addressTitle.textContent = 'Confirma tu domicilio actual';
      addressHelper.textContent = `Usa como referencia ${sourceName}. Si algún dato no coincide con tu domicilio actual, modifícalo antes de continuar.`;
    }
  }

  function addBeneficiary(values = {}) {
    beneficiarySeq += 1;
    const node = beneficiaryTemplate.content.cloneNode(true);
    const card = node.querySelector('.beneficiary-card');
    card.dataset.id = beneficiarySeq;
    const name = card.querySelector('[data-field="name"]');
    const relationship = card.querySelector('[data-field="relationship"]');
    const percentage = card.querySelector('[data-field="percentage"]');

    name.name = `beneficiary_${beneficiarySeq}_name`;
    relationship.name = `beneficiary_${beneficiarySeq}_relationship`;
    percentage.name = `beneficiary_${beneficiarySeq}_percentage`;
    name.value = values.name || '';
    relationship.value = values.relationship || '';
    percentage.value = values.percentage || '';

    card.querySelector('.remove-beneficiary').addEventListener('click', () => {
      if (beneficiaries.children.length === 1) return;
      card.remove();
      renumberBeneficiaries();
      updateBeneficiaryTotal();
      updateMissingCount();
    });

    card.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => {
        validateInput(input);
        updateBeneficiaryTotal();
        updateMissingCount();
      });
    });

    beneficiaries.appendChild(node);
    renumberBeneficiaries();
    updateBeneficiaryTotal();
  }

  function renumberBeneficiaries() {
    [...beneficiaries.children].forEach((card, index) => {
      card.querySelector('.beneficiary-title').textContent = `Beneficiario ${index + 1}`;
      card.querySelector('.remove-beneficiary').style.visibility =
        beneficiaries.children.length === 1 ? 'hidden' : 'visible';
    });
  }

  function getBeneficiaryTotal() {
    return [...beneficiaries.querySelectorAll('[data-field="percentage"]')]
      .reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  }

  function updateBeneficiaryTotal() {
    const total = getBeneficiaryTotal();
    beneficiaryTotal.textContent = `Total asignado: ${total}%`;
    beneficiaryTotal.style.color = total === 100 ? 'var(--ok)' : 'var(--muted)';
  }

  function collectBeneficiaries() {
    return [...beneficiaries.querySelectorAll('.beneficiary-card')].map(card => ({
      name: card.querySelector('[data-field="name"]').value.trim(),
      relationship: card.querySelector('[data-field="relationship"]').value.trim(),
      percentage: Number(card.querySelector('[data-field="percentage"]').value) || 0
    }));
  }

  function renderReview() {
    const data = new FormData(form);
    const addressSourceMap = {
      ine: 'Domicilio de la INE',
      proof: 'Domicilio del comprobante',
      other: 'Domicilio diferente'
    };
    const source = addressSourceMap[data.get('addressSource')] || '—';
    const beneficiaryText = collectBeneficiaries()
      .map(b => `${escapeHtml(b.name)} — ${escapeHtml(b.relationship)} — ${b.percentage}%`)
      .join('<br>');

    const rows = [
      ['Nombre', data.get('fullName') || '—'],
      ['Profesión / ocupación', data.get('profession') || '—'],
      ['Correo', data.get('email') || '—'],
      ['Teléfono', data.get('phone') || '—'],
      ['Domicilio basado en', source],
      ['Calle y número', data.get('street') || '—'],
      ['Colonia', data.get('neighborhood') || '—'],
      ['Código postal', data.get('postalCode') || '—'],
      ['Ciudad / municipio', data.get('city') || '—'],
      ['Estado', data.get('state') || '—'],
      ['Beneficiarios', beneficiaryText || '—'],
      ['INE frente', fileName(data.get('ineFront'))],
      ['INE reverso', fileName(data.get('ineBack'))],
      ['Comprobante', fileName(data.get('addressProof'))]
    ];

    reviewCard.innerHTML = `<dl>${rows.map(([k, v]) =>
      `<dt>${escapeHtml(k)}</dt><dd>${typeof v === 'string' && v.includes('<br>') ? v : escapeHtml(String(v))}</dd>`
    ).join('')}</dl>`;
  }

  function fileName(file) {
    return file && typeof file === 'object' && 'name' in file && file.name ? file.name : '—';
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validateStep(steps[currentStep])) return;

    const cfg = window.GARBA_CONFIG || {};
    submitMessage.className = 'submit-message';

    if (!cfg.submitEndpoint || cfg.mode === 'demo') {
      submitMessage.textContent = 'La captura está completa, pero el envío seguro todavía no está conectado.';
      submitMessage.classList.add('info');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando…';
    try {
      const response = await fetch(cfg.submitEndpoint, {
        method: 'POST',
        body: new FormData(form)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No fue posible enviar la solicitud.');
      submitMessage.textContent = 'Tu información fue enviada correctamente.';
      submitMessage.classList.add('info');
    } catch (error) {
      submitMessage.textContent = error.message || 'Ocurrió un error al enviar. Intenta nuevamente.';
      submitMessage.classList.add('error-state');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar a Christian';
    }
  }

  nextBtn.addEventListener('click', () => {
    if (!validateStep(steps[currentStep])) return;
    showStep(currentStep + 1);
  });

  prevBtn.addEventListener('click', () => showStep(currentStep - 1));
  form.addEventListener('submit', handleSubmit);
  addBeneficiaryBtn.addEventListener('click', () => addBeneficiary());

  form.addEventListener('input', event => {
    if (event.target.matches('input')) {
      validateInput(event.target);
      updateMissingCount();
    }
  });

  form.addEventListener('change', event => {
    if (event.target.name === 'addressSource') handleAddressSource();
    if (event.target.matches('input[type="file"], input[type="radio"], input[type="checkbox"]')) {
      validateInput(event.target);
      updateMissingCount();
    }
  });

  addBeneficiary({ percentage: 100 });
  showStep(0);
})();