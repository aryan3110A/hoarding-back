import { RentRepository } from '../repositories/rent.repository';
import { EmailService } from '../services/email.service';
import { NotificationService } from '../services/notification.service';
import { UserRepository } from '../repositories/user.repository';
import { RentService } from '../services/rent.service';
import { PropertyRentService } from '../services/propertyRent.service';
import { AccountantService } from '../services/accountant.service';

const rentRepository = new RentRepository();
const emailService = new EmailService();
const notificationService = new NotificationService();
const userRepository = new UserRepository();
const rentService = new RentService();
const propertyRentService = new PropertyRentService();
const accountantService = new AccountantService();

export class ReminderJob {
  async sendRentReminders(days = 7) {
    // Process annual increments first
    try {
      console.log('Checking for annual rent increments...');
      const incrementedCount = await rentService.processAnnualIncrements();
      console.log(`Incremented rent for ${incrementedCount} hoardings.`);
    } catch (err) {
      console.error('Error processing annual increments:', err);
    }

    // Process property group increments (compounding)
    try {
      const applied = await propertyRentService.applyDueIncrements();
      if (applied > 0) {
        console.log(`Applied ${applied} property rent increments.`);
      }
    } catch (err) {
      console.error('Error processing property rent increments:', err);
    }

    console.log(`Running Rent Reminder Job (Due in ${days} days)...`);

    const upcomingRents = await rentRepository.findUpcomingDues(days);
    console.log(`Found ${upcomingRents.length} rents due soon.`);

    // Find Owner to send emails to (as per spec: "send email to Owner")
    // In a real app, we might send to specific users, but spec says "Owner"
    const owners = await userRepository.findByRole('owner'); // Assuming this method exists or we filter
    // Actually UserRepository might not have findByRole, let's check or implement a workaround.
    // For now, let's assume we send to a configured OWNER_EMAIL env var or the first owner found.

    // Find Owner to send emails to
    // Priority: 1. Environment Variable 2. Database User with role 'owner'
    let ownerEmail = process.env.OWNER_EMAIL;
    let ownerId: string | undefined;

    if (!ownerEmail) {
      const owners = await userRepository.findByRole('owner');
      if (owners && owners.length > 0) {
        ownerEmail = owners[0].email || undefined;
        ownerId = owners[0].id;
      }
    } else {
      // If env var is used, try to find a matching user to link notification
      const user = await userRepository.findByEmail(ownerEmail);
      if (user) ownerId = user.id;
    }

    if (!ownerEmail) {
      console.warn(
        'No owner email found (checked OWNER_EMAIL env and database roles). Skipping email reminders.',
      );
      return { sent: 0, errors: 0 };
    }

    let sentCount = 0;
    let errorCount = 0;

    for (const rent of upcomingRents) {
      try {
        const hoardingCode = rent.hoarding?.code || 'Unknown';
        const dueDate = rent.nextDueDate
          ? new Date(rent.nextDueDate).toLocaleDateString()
          : 'Unknown';
        const amount = rent.rentAmount;

        const subject = `Rent Due Reminder: Hoarding ${hoardingCode}`;
        const text = `Rent for Hoarding ${hoardingCode} is due on ${dueDate}. Amount: ${amount}. Please ensure payment is made.`;

        await emailService.sendEmail({
          to: ownerEmail,
          subject,
          text,
        });

        // Create in-app notification for owner
        if (ownerId) {
          await notificationService.createNotification(
            ownerId,
            subject,
            text,
            `/hoardings/${rent.hoardingId}/rent`,
          );
        }

        sentCount++;
      } catch (error) {
        console.error(`Failed to send reminder for rent ${rent.id}`, error);
        errorCount++;
      }
    }

    return { sent: sentCount, errors: errorCount };
  }

  async sendInvoiceReminders() {
    console.log('Running Invoice Reminder Job...');
    try {
      const result = await accountantService.sendDueInvoiceReminders();
      console.log(`Sent ${result.sent} invoice reminder(s).`);
      return result;
    } catch (error) {
      console.error('Failed to send invoice reminders', error);
      return { sent: 0 };
    }
  }
}
